import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { z } from "zod/v4";
import { GetNotificationsResponse, ReadNotificationsBody, ReadNotificationsResponse } from "@workspace/api-zod";
import { createRateLimiter, getAuthContext, requireAuth } from "../lib/auth";
import { notifyAccountActivity } from "../lib/live-gateway";

const router: IRouter = Router();
router.use("/notifications", requireAuth, createRateLimiter("notifications", 90));

// Read actual stored social actions; never accept client-supplied notifications or
// keep a second event database that can drift away from the content/relationships.
router.get("/notifications", async (req, res): Promise<void> => {
  const parsed = z.object({ before: z.coerce.number().int().positive().optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "Choose a valid notification page." }); return; }
  const { userId } = getAuthContext(res);
  const before = Math.min(parsed.data.before || Date.now() + 1, Date.now() + 1);
  const [activity, cursor] = await Promise.all([
    pool.query(`
      WITH activity AS (
        SELECT 'like:'||l.user_id||':'||l.post_id AS id, 'like' AS kind,
          'liked your post' AS body, l.user_id AS actor_id,
          l.post_id, NULL::uuid AS story_id, NULL::uuid AS comment_id, l.created_at AS at
        FROM post_likes l JOIN posts p ON p.id=l.post_id WHERE p.author_id=$1
        UNION ALL
        SELECT 'repost:'||r.user_id||':'||r.post_id, 'share', 'reposted your post',
          r.user_id, r.post_id, NULL::uuid, NULL::uuid, r.created_at
        FROM post_reposts r JOIN posts p ON p.id=r.post_id WHERE p.author_id=$1
        UNION ALL
        SELECT 'comment:'||c.id, 'comment', 'commented on your post',
          c.user_id, c.post_id, NULL::uuid, c.id, c.created_at
        FROM post_comments c JOIN posts p ON p.id=c.post_id WHERE p.author_id=$1
        UNION ALL
        SELECT 'reply:'||c.id, 'reply', 'replied to your comment',
          c.user_id, c.post_id, NULL::uuid, c.id, c.created_at
        FROM post_comments c JOIN post_comments parent ON parent.id=c.parent_id
          JOIN posts p ON p.id=c.post_id
        WHERE parent.user_id=$1 AND p.author_id<>$1
        UNION ALL
        SELECT 'follow:'||f.follower_id, 'follow', 'started following you',
          f.follower_id, NULL::uuid, NULL::uuid, NULL::uuid, f.created_at
        FROM user_follows f WHERE f.followed_id=$1
        UNION ALL
        SELECT 'friend:'||f.member_low_id||':'||f.member_high_id, 'friend-accepted', 'is now your Friend',
          CASE WHEN f.member_low_id=$1 THEN f.member_high_id ELSE f.member_low_id END,
          NULL::uuid, NULL::uuid, NULL::uuid, f.created_at
        FROM friendships f WHERE f.member_low_id=$1 OR f.member_high_id=$1
        UNION ALL
        SELECT 'story-reaction:'||r.actor_id||':'||r.story_id, 'story-reaction', 'reacted to your story',
          r.actor_id, NULL::uuid, r.story_id, NULL::uuid, r.updated_at
        FROM story_reactions r JOIN stories s ON s.id=r.story_id
        WHERE s.author_id=$1 AND s.expires_at>now()
        UNION ALL
        SELECT 'story-comment:'||c.id, 'story-comment', 'commented on your story',
          c.author_id, NULL::uuid, c.story_id, c.id, c.created_at
        FROM story_comments c JOIN stories s ON s.id=c.story_id
        WHERE s.author_id=$1 AND s.expires_at>now()
      )
      SELECT a.id,a.kind,a.body,a.post_id AS "postId",a.story_id AS "storyId",a.comment_id AS "commentId",
        floor(extract(epoch FROM a.at)*1000)::float8 AS "createdAt",
        u.id AS "actorId",u.username,u.display_name AS "displayName",
        st.data->'profile'->>'avatar' AS avatar
      FROM activity a JOIN users u ON u.id=a.actor_id LEFT JOIN account_state st ON st.user_id=u.id
      WHERE a.actor_id<>$1 AND a.at<to_timestamp($2::float8/1000)
        AND NOT EXISTS (SELECT 1 FROM account_blocks b
          WHERE (b.owner_id=$1 AND b.blocked_id=a.actor_id) OR (b.owner_id=a.actor_id AND b.blocked_id=$1))
      ORDER BY a.at DESC,a.id DESC LIMIT 101`, [userId, before]),
    pool.query(`SELECT data->>'notificationReadAt' AS "readAt" FROM account_state WHERE user_id=$1`, [userId]),
  ]);
  const readAt = Number(cursor.rows[0]?.readAt) || 0;
  const rows = activity.rows.slice(0, 100);
  res.json(GetNotificationsResponse.parse({
    readAt,
    nextBefore: activity.rows.length > 100 ? Number(rows.at(-1)?.createdAt) : null,
    notifications: rows.map(row => ({
      id: row.id, kind: row.kind, body: row.body,
      postId: row.postId, storyId: row.storyId, commentId: row.commentId,
      createdAt: Number(row.createdAt), read: Number(row.createdAt) <= readAt,
      actor: { id: row.actorId, username: row.username, displayName: row.displayName, avatar: row.avatar || null },
    })),
  }));
});

router.post("/notifications/read", async (req, res): Promise<void> => {
  const parsed = ReadNotificationsBody.strict().safeParse(req.body);
  if (!parsed.success || !Number.isSafeInteger(parsed.data.through) || parsed.data.through > Date.now() + 1000) {
    res.status(400).json({ error: "Choose a valid notification read time." }); return;
  }
  const { userId } = getAuthContext(res);
  const result = await pool.query(`
    INSERT INTO account_state(user_id,data,updated_at)
    VALUES ($1,jsonb_build_object('notificationReadAt',$2::bigint),now())
    ON CONFLICT (user_id) DO UPDATE SET
      data=account_state.data||jsonb_build_object('notificationReadAt',
        greatest(coalesce((account_state.data->>'notificationReadAt')::bigint,0),$2::bigint)),
      updated_at=now()
    RETURNING data->>'notificationReadAt' AS "readAt"`, [userId, parsed.data.through]);
  notifyAccountActivity(userId);
  res.json(ReadNotificationsResponse.parse({ readAt: Number(result.rows[0].readAt) }));
});

export default router;
