import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { notifyAccountActivity } from "../lib/live-gateway";
import { z } from "zod/v4";
import { workoutTagData } from "./sports-social";
import { sportsPostSourceId } from "../lib/sports-posts";
import { SPORTS_MODE_ENABLED } from "../lib/sports-feature-state.js";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  CreatePostBody,
  DeletePostParams,
  GetUserProfileParams,
  ImportLegacyPostsBody,
  LikePostParams,
  GetAccountPostParams,
  GetAccountPostResponse,
  ListFeedQueryParams,
  RepostPostBody,
  RepostPostParams,
  RemovePostRepostParams,
  RemovePostRepostResponse,
  RepostPostResponse,
  SearchUsersQueryParams,
  UnlikePostParams,
} from "@workspace/api-zod";
import type {
  ErrorResponse,
  FeedResponse,
  LikeResponse,
  PostCreationResult,
  PostImportResponse,
  ProfileResponse,
  PublicProfile,
  SocialPost,
  UserSearchResults,
} from "@workspace/api-zod";
import {
  db, accountBlocksTable, accountStateTable, closeFriendMembersTable, followRequestsTable, friendRequestsTable,
  friendshipsTable, relationshipMigrationsTable, postCommentsTable, postLikesTable, postRepostsTable, postMediaAssetsTable, postsTable, userFollowsTable,
  analyticsResourcesTable, analyticsSessionsTable, userMediaAssetsTable, usersTable, workoutsTable, sportsMediaTable,
} from "@workspace/db";
import { getAuthContext, requireAuth } from "../lib/auth";
import { refreshCreatorsAfterActivity } from "../lib/creator-program";
import { placeTagSchema, type PlaceTag } from "../lib/place-tag";
import { publicProfileDetails } from "../lib/public-profile-media";
import { rankFeedCandidates, type FeedSurface } from "../lib/feed-ranking";

const router: IRouter = Router();
const MAX_POSTS = 50;
const MAX_PROFILE_POSTS = 50;
const MAX_SEARCH_RESULTS = 20;

function legacyCommentUuid(userId: string, postSourceId: string, commentSourceId: string) {
  const bytes = createHash("sha256")
    .update(`${userId}\u0000${postSourceId}\u0000${commentSourceId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function orderedFriendIds(left: string, right: string) {
  return left < right
    ? { memberLowId: left, memberHighId: right }
    : { memberLowId: right, memberHighId: left };
}

async function blockedPair(left: string, right: string) {
  const [row] = await db
    .select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable)
    .where(
      or(
        and(eq(accountBlocksTable.ownerId, left), eq(accountBlocksTable.blockedId, right)),
        and(eq(accountBlocksTable.ownerId, right), eq(accountBlocksTable.blockedId, left)),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function relationshipProfiles(ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return new Map<string, { id: string; username: string; displayName: string }>();
  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, uniqueIds));
  return new Map(rows.map(row => [row.id, row]));
}

type PostRow = {
  place: PlaceTag | null;
  sportsCard: Record<string, unknown> | null;
  id: string;
  sourceId: string | null;
  remixSourcePostId: string | null;
  text: string;
  visibility: string;
  destination: string;
  createdAt: Date;
  authorId: string;
  followedAuthor?: boolean;
  username: string;
  displayName: string;
  joinedAt: Date;
};

function publicProfile(user: {
  id: string;
  username: string;
  displayName: string;
  createdAt: Date;
}): PublicProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    joinedAt: user.createdAt.getTime(),
  };
}

export function postVisibilityForViewer(viewerId: string) {
  return or(
    eq(postsTable.visibility, "public"),
    eq(postsTable.authorId, viewerId),
    sql`(${postsTable.visibility} = 'close-friends' AND EXISTS (
      SELECT 1 FROM close_friend_members cfm
      WHERE cfm.owner_id = ${postsTable.authorId} AND cfm.member_id = ${viewerId}
    ))`,
  )!;
}

function postAccountVisibilityForViewer(viewerId: string) {
  return sql`(
    ${usersTable.isPrivate} = false OR ${postsTable.authorId} = ${viewerId} OR
    EXISTS (SELECT 1 FROM user_follows uf
      WHERE uf.follower_id = ${viewerId} AND uf.followed_id = ${postsTable.authorId})
  )`;
}

function postNotBlockedForViewer(viewerId: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM account_blocks ab
    WHERE (ab.owner_id = ${viewerId} AND ab.blocked_id = ${postsTable.authorId})
       OR (ab.owner_id = ${postsTable.authorId} AND ab.blocked_id = ${viewerId})
  )`;
}

async function listPostRows(
  limit: number,
  viewerId: string,
  authorId?: string,
  offset = 0,
  surface: FeedSurface = "main",
): Promise<PostRow[]> {
  const audienceVisible = postVisibilityForViewer(viewerId);
  const accountVisible = postAccountVisibilityForViewer(viewerId);
  const notBlocked = postNotBlockedForViewer(viewerId);
  const mainDestination = inArray(postsTable.destination, ["main", "both"]);
  const followedAuthors = sql`(
    ${postsTable.authorId} = ${viewerId} OR EXISTS (
      SELECT 1 FROM user_follows uf
      WHERE uf.follower_id = ${viewerId} AND uf.followed_id = ${postsTable.authorId}
    )
  )`;
  const friendRepostedPosts = sql`EXISTS (
    SELECT 1
    FROM post_reposts pr
    JOIN friendships f
      ON (
        (f.member_low_id = ${viewerId} AND f.member_high_id = pr.user_id)
        OR (f.member_high_id = ${viewerId} AND f.member_low_id = pr.user_id)
      )
    WHERE pr.post_id = ${postsTable.id}
      AND NOT EXISTS (
        SELECT 1 FROM account_blocks b
        WHERE (b.owner_id = ${viewerId} AND b.blocked_id = pr.user_id)
          OR (b.owner_id = pr.user_id AND b.blocked_id = ${viewerId})
      )
  )`;
  const query = db
    .select({
      id: postsTable.id,
      sourceId: postsTable.sourceId,
      remixSourcePostId: postsTable.remixSourcePostId,
      text: postsTable.text,
      visibility: postsTable.visibility,
      destination: postsTable.destination,
      place: postsTable.place,
      sportsCard: postsTable.sportsCard,
      createdAt: postsTable.createdAt,
      authorId: usersTable.id,
      followedAuthor: sql<boolean>`EXISTS (
        SELECT 1 FROM user_follows uf
        WHERE uf.follower_id = ${viewerId} AND uf.followed_id = ${postsTable.authorId}
      )`,
      username: usersTable.username,
      displayName: usersTable.displayName,
      joinedAt: usersTable.createdAt,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.authorId, usersTable.id));

  if (authorId) {
    return query
      .where(and(eq(postsTable.authorId, authorId), audienceVisible, accountVisible, notBlocked, mainDestination))
      .orderBy(desc(postsTable.createdAt), desc(postsTable.id))
      .limit(limit)
      .offset(offset);
  }

  const communitySurface = surface === "community" || surface === "community-following";
  const surfaceFilter = communitySurface
    ? and(
      eq(postsTable.visibility, "public"),
      eq(usersTable.isPrivate, false),
      inArray(postsTable.destination, ["community", "both"]),
      ...(surface === "community-following"
        ? [sql`(${followedAuthors} OR ${friendRepostedPosts})`]
        : []),
    )
    : surface === "following"
      ? and(mainDestination, followedAuthors)
      : and(mainDestination, accountVisible);
  return query
    .where(and(audienceVisible, surfaceFilter, notBlocked))
    .orderBy(desc(postsTable.createdAt), desc(postsTable.id))
    .limit(limit)
    .offset(offset);
}

async function rankPostsForViewer(
  rows: PostRow[],
  posts: SocialPost[],
  viewerId: string,
  surface: FeedSurface,
): Promise<SocialPost[]> {
  if (!rows.length || !posts.length) return posts;
  const ids = rows.map(row => row.id);
  const repeatAfter = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const historyAfter = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [comments, watchRows, stateRows] = await Promise.all([
    db.select({
      postId: postCommentsTable.postId,
      commenters: sql<number>`count(distinct ${postCommentsTable.userId})::int`,
    }).from(postCommentsTable)
      .where(inArray(postCommentsTable.postId, ids))
      .groupBy(postCommentsTable.postId),
    db.select({
      sourceId: analyticsResourcesTable.sourceId,
      progress: sql<number>`avg(${analyticsSessionsTable.progress})`,
      recentlyViewed: sql<boolean>`bool_or(${analyticsSessionsTable.qualified} AND ${analyticsSessionsTable.startedAt} >= ${repeatAfter})`,
    }).from(analyticsSessionsTable)
      .innerJoin(analyticsResourcesTable, eq(analyticsResourcesTable.id, analyticsSessionsTable.resourceId))
      .where(and(
        eq(analyticsSessionsTable.actorId, viewerId),
        inArray(analyticsResourcesTable.sourceId, ids),
        inArray(analyticsResourcesTable.ownerId, [...new Set(rows.map(row => row.authorId))]),
        gte(analyticsSessionsTable.startedAt, historyAfter),
        isNull(analyticsResourcesTable.deletedAt),
      ))
      .groupBy(analyticsResourcesTable.sourceId),
    db.select({ data: accountStateTable.data })
      .from(accountStateTable)
      .where(eq(accountStateTable.userId, viewerId))
      .limit(1),
  ]);
  const rowById = new Map(rows.map(row => [row.id, row]));
  const commentsByPost = new Map(comments.map(row => [row.postId, Number(row.commenters) || 0]));
  const watchByPost = new Map(watchRows.map(row => [
    row.sourceId,
    { progress: Number(row.progress) || 0, recentlyViewed: row.recentlyViewed === true },
  ]));
  const state = stateRows[0]?.data;
  const stateObject = state && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
  const profile = stateObject.profile && typeof stateObject.profile === "object"
    ? stateObject.profile as Record<string, unknown>
    : {};
  const preferences = stateObject.interestPreferences && typeof stateObject.interestPreferences === "object"
    ? stateObject.interestPreferences as Record<string, unknown>
    : {};
  const interests = new Set<string>([
    ...(Array.isArray(profile.interests) ? profile.interests : []),
    ...(preferences.enabled === true && Array.isArray(preferences.selected) ? preferences.selected : []),
  ].filter((value): value is string => typeof value === "string").map(value => value.toLowerCase()));
  const byId = new Map(posts.map(post => [post.id, post]));
  const candidates = rows.flatMap(row => {
    const post = byId.get(row.id);
    if (!post) return [];
    const watch = watchByPost.get(row.id);
    const text = post.text.toLowerCase();
    const interestMatches = [...interests].filter(interest => text.includes(interest)).length;
    return [{
      id: post.id,
      authorId: post.author.id,
      createdAt: post.createdAt,
      text: post.text,
      likeCount: post.likeCount,
      repostCount: post.repostCount,
      distinctCommenters: commentsByPost.get(post.id) || 0,
      followedAuthor: rowById.get(post.id)?.followedAuthor || false,
      likedByMe: post.likedByMe,
      repostedByMe: post.repostedByMe,
      watchProgress: watch?.progress || 0,
      qualifiedViewRecently: watch?.recentlyViewed || false,
      interestMatches,
    }];
  });
  const rankedIds = rankFeedCandidates(candidates, surface).map(candidate => candidate.id);
  return rankedIds.flatMap(id => {
    const post = byId.get(id);
    return post ? [post] : [];
  });
}

async function postsForViewer(rows: PostRow[], viewerId: string): Promise<SocialPost[]> {
  if (rows.length === 0) {
    return [];
  }

  const postIds = rows.map((row) => row.id);
  const ranked = db.select({postId:postLikesTable.postId,id:usersTable.id,username:usersTable.username,
    displayName:usersTable.displayName,joinedAt:usersTable.createdAt,
    rank:sql<number>`row_number() over (partition by ${postLikesTable.postId} order by ${postLikesTable.createdAt} desc, ${postLikesTable.userId})`.as("like_rank")})
    .from(postLikesTable).innerJoin(usersTable,eq(usersTable.id,postLikesTable.userId))
    .where(inArray(postLikesTable.postId,postIds)).as("recent_likers");
  const [likeCounts, viewerLikes, recentLikers, repostCounts, viewerReposts, commentCounts, saveCounts, remixCounts, authorDetails, mediaRows] = await Promise.all([
    db
      .select({
        postId: postLikesTable.postId,
        likeCount: sql<number>`count(*)::int`,
      })
      .from(postLikesTable)
      .where(inArray(postLikesTable.postId, postIds))
      .groupBy(postLikesTable.postId),
    db
      .select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(
        and(
          eq(postLikesTable.userId, viewerId),
          inArray(postLikesTable.postId, postIds),
        ),
      ),
    db.select({postId:ranked.postId,id:ranked.id,username:ranked.username,displayName:ranked.displayName,joinedAt:ranked.joinedAt})
      .from(ranked).where(sql`${ranked.rank} <= 3`),
    db.select({
      postId: postRepostsTable.postId,
      repostCount: sql<number>`count(*)::int`,
    })
      .from(postRepostsTable)
      .where(inArray(postRepostsTable.postId, postIds))
      .groupBy(postRepostsTable.postId),
    db.select({ postId: postRepostsTable.postId, note: postRepostsTable.note })
      .from(postRepostsTable)
      .where(and(eq(postRepostsTable.userId, viewerId), inArray(postRepostsTable.postId, postIds))),
    db.select({
      postId: postCommentsTable.postId,
      commentCount: sql<number>`count(*)::int`,
    })
      .from(postCommentsTable)
      .where(inArray(postCommentsTable.postId, postIds))
      .groupBy(postCommentsTable.postId),
    db.select({
      postId: postsTable.id,
      saveCount: sql<number>`count(*)::int`,
    })
      .from(postsTable)
      .innerJoin(accountStateTable, sql`coalesce(${accountStateTable.data}->'savedPostIds', '[]'::jsonb) @> jsonb_build_array(${postsTable.id}::text)`)
      .where(inArray(postsTable.id, postIds))
      .groupBy(postsTable.id),
    db.select({
      postId: postsTable.remixSourcePostId,
      remixCount: sql<number>`count(*)::int`,
    })
      .from(postsTable)
      .innerJoin(usersTable, eq(usersTable.id, postsTable.authorId))
      .where(and(
        inArray(postsTable.remixSourcePostId, postIds),
        postVisibilityForViewer(viewerId),
        postAccountVisibilityForViewer(viewerId),
        postNotBlockedForViewer(viewerId),
      ))
      .groupBy(postsTable.remixSourcePostId),
    publicProfileDetails(rows.map(row => row.authorId), viewerId),
    db.select({
      postId: postMediaAssetsTable.postId,
      id: userMediaAssetsTable.id,
      contentType: userMediaAssetsTable.contentType,
    }).from(postMediaAssetsTable)
      .innerJoin(userMediaAssetsTable, eq(userMediaAssetsTable.id, postMediaAssetsTable.mediaId))
      .where(inArray(postMediaAssetsTable.postId, postIds))
      .orderBy(postMediaAssetsTable.position),
  ]);
  const mediaByPost = new Map<string, SocialPost["media"]>();
  for (const media of mediaRows) {
    const items = mediaByPost.get(media.postId) || [];
    items.push({ id: media.id, contentType: media.contentType as SocialPost["media"][number]["contentType"], reference: `oldtime-media:${media.id}` });
    mediaByPost.set(media.postId, items);
  }

  const counts = new Map(likeCounts.map((item) => [item.postId, Number(item.likeCount)]));
  const liked = new Set(viewerLikes.map((item) => item.postId));
  const repostCountsByPost = new Map(repostCounts.map(item => [item.postId, Number(item.repostCount)]));
  const repostsByMe = new Map(viewerReposts.map(item => [item.postId, item.note]));
  const commentCountsByPost = new Map(commentCounts.map(item => [item.postId, Number(item.commentCount)]));
  const saveCountsByPost = new Map(saveCounts.map(item => [item.postId, Number(item.saveCount)]));
  const remixCountsByPost = new Map(remixCounts.map(item => [item.postId, Number(item.remixCount)]));

  return rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    remixSourcePostId: row.remixSourcePostId,
    text: row.text,
    visibility: row.visibility as SocialPost["visibility"],
    destination: row.destination as SocialPost["destination"],
    media: mediaByPost.get(row.id) || [],
    place: row.place,
    sportsCard: row.sportsCard ? { activityType: row.sportsCard.activityType, summary: row.sportsCard.summary,
      mediaType: row.sportsCard.mediaType || "image", challenge: row.sportsCard.challenge || null, taggedPeople: row.sportsCard.taggedPeople || [],
      imageUrl: row.sportsCard.imageId ? `/api/posts/${row.id}/sports-card?v=${row.sportsCard.imageId}` : null } : null,
    createdAt: row.createdAt.getTime(),
    author: {
      id: row.authorId,
      username: row.username,
      displayName: row.displayName,
      joinedAt: row.joinedAt.getTime(),
      ...authorDetails.get(row.authorId),
    },
    likeCount: counts.get(row.id) ?? 0,
    likedByMe: liked.has(row.id),
    commentCount: commentCountsByPost.get(row.id) ?? 0,
    saveCount: saveCountsByPost.get(row.id) ?? 0,
    repostCount: repostCountsByPost.get(row.id) ?? 0,
    remixCount: remixCountsByPost.get(row.id) ?? 0,
    repostedByMe: repostsByMe.has(row.id),
    repostNote: repostsByMe.get(row.id) ?? null,
    likedBy: recentLikers.filter(person=>person.postId===row.id).map(person=>({
      id:person.id,username:person.username,displayName:person.displayName,joinedAt:person.joinedAt.getTime(),
    })),
  }));
}

async function addFriendRepostAttribution(posts: SocialPost[], viewerId: string): Promise<SocialPost[]> {
  if (!posts.length) return posts;
  const postIds = posts.map(post => post.id);
  const rows = await db.select({
    postId: postRepostsTable.postId,
    id: usersTable.id,
    username: usersTable.username,
    displayName: usersTable.displayName,
    joinedAt: usersTable.createdAt,
  }).from(postRepostsTable)
    .innerJoin(usersTable, eq(usersTable.id, postRepostsTable.userId))
    .innerJoin(friendshipsTable, or(
      and(
        eq(friendshipsTable.memberLowId, viewerId),
        eq(friendshipsTable.memberHighId, postRepostsTable.userId),
      ),
      and(
        eq(friendshipsTable.memberHighId, viewerId),
        eq(friendshipsTable.memberLowId, postRepostsTable.userId),
      ),
    ))
    .where(and(
      inArray(postRepostsTable.postId, postIds),
      sql`NOT EXISTS (
        SELECT 1 FROM ${accountBlocksTable} AS b
        WHERE (b.owner_id = ${viewerId} AND b.blocked_id = ${usersTable.id})
          OR (b.owner_id = ${usersTable.id} AND b.blocked_id = ${viewerId})
      )`,
    ))
    .orderBy(desc(postRepostsTable.updatedAt));
  const profileDetails = await publicProfileDetails([...new Set(rows.map(row => row.id))], viewerId);
  const groups = new Map<string, Array<SocialPost["author"]>>();
  for (const row of rows) {
    const group = groups.get(row.postId) || [];
    group.push({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      joinedAt: row.joinedAt.getTime(),
      ...profileDetails.get(row.id),
    });
    groups.set(row.postId, group);
  }
  return posts.map(post => {
    const friends = groups.get(post.id) || [];
    return {
      ...post,
      friendRepostCount: friends.length,
      repostedByFriends: friends.slice(0, 3),
    };
  });
}

async function getPostRow(postId: string): Promise<PostRow | undefined> {
  const [row] = await db
    .select({
      id: postsTable.id,
      sourceId: postsTable.sourceId,
      remixSourcePostId: postsTable.remixSourcePostId,
      text: postsTable.text,
      visibility: postsTable.visibility,
      destination: postsTable.destination,
      place: postsTable.place,
      sportsCard: postsTable.sportsCard,
      createdAt: postsTable.createdAt,
      authorId: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      joinedAt: usersTable.createdAt,
    })
    .from(postsTable)
    .innerJoin(usersTable, eq(postsTable.authorId, usersTable.id))
    .where(eq(postsTable.id, postId))
    .limit(1);
  return row;
}

async function currentLikeCount(postId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postLikesTable)
    .where(eq(postLikesTable.postId, postId));
  return Number(result?.count ?? 0);
}

async function currentRepostCount(postId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(postRepostsTable)
    .where(eq(postRepostsTable.postId, postId));
  return Number(result?.count ?? 0);
}

async function visiblePostForRepost(postId: string, viewerId: string) {
  const [post] = await db
    .select({ id: postsTable.id, authorId: postsTable.authorId })
    .from(postsTable)
    .where(and(eq(postsTable.id, postId), postVisibilityForViewer(viewerId)))
    .limit(1);
  if (!post || await blockedPair(viewerId, post.authorId)) return null;
  return post;
}

async function visiblePostForRemix(postId: string, viewerId: string) {
  const [post] = await db
    .select({ id: postsTable.id, authorId: postsTable.authorId })
    .from(postsTable)
    .innerJoin(usersTable, eq(usersTable.id, postsTable.authorId))
    .where(and(
      eq(postsTable.id, postId),
      postVisibilityForViewer(viewerId),
      postAccountVisibilityForViewer(viewerId),
      postNotBlockedForViewer(viewerId),
    ))
    .limit(1);
  return post || null;
}

router.get("/posts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAccountPostParams.safeParse(req.params);
  const { userId } = getAuthContext(res);
  const post = params.success ? await visiblePostForRepost(params.data.id, userId) : null;
  if (!post) { res.status(404).json({ error: "This post was removed or is no longer visible to your account." }); return; }
  const row = await getPostRow(post.id);
  if (!row) { res.status(404).json({ error: "Post no longer exists." }); return; }
  res.json(GetAccountPostResponse.parse({ post: (await postsForViewer([row], userId))[0] }));
});

router.get("/feed", requireAuth, async (req, res): Promise<void> => {
  const params = ListFeedQueryParams.safeParse(req.query);
  if (!params.success) {
    const response: ErrorResponse = { error: "The feed request is invalid." };
    res.status(400).json(response);
    return;
  }

  const { userId } = getAuthContext(res);
  const surface = params.data.surface as FeedSurface;
  const limit = Math.min(params.data.limit ?? 30, MAX_POSTS);
  const offset = params.data.offset ?? 0;
  const rows = await listPostRows(
    limit + 1,
    userId,
    undefined,
    offset,
    surface,
  );
  const pageRows = rows.slice(0, limit);
  const viewerPosts = await postsForViewer(pageRows, userId);
  const communityPosts = surface === "community" || surface === "community-following"
    ? await addFriendRepostAttribution(viewerPosts, userId)
    : viewerPosts;
  const response: FeedResponse = {
    posts: await rankPostsForViewer(pageRows, communityPosts, userId, surface),
    hasMore: rows.length > limit,
    nextOffset: offset + pageRows.length
  };
  res.json(response);
});

router.post("/posts", requireAuth, async (req, res): Promise<void> => {
  const place = placeTagSchema.nullable().optional().safeParse(req.body?.place);
  if (!place.success) { res.status(400).json({ error: "Choose a valid named place." }); return; }
  const parsed = CreatePostBody.safeParse(req.body);
  if (!parsed.success) {
    const response: ErrorResponse = { error: "Posts must be between 1 and 1,000 characters." };
    res.status(400).json(response);
    return;
  }
  if (!SPORTS_MODE_ENABLED && (parsed.data.workoutId || parsed.data.sportsCardId)) {
    res.status(410).json({ error: "Sports publishing is currently disabled." });
    return;
  }

  const text = parsed.data.text.trim();
  const mediaIds = [...new Set(parsed.data.mediaIds || [])];
  const visibility = parsed.data.visibility || "public";
  const destination = parsed.data.destination || "main";
  if ((!text && mediaIds.length === 0) || text.length > 1000 || mediaIds.length > 10) {
    const response: ErrorResponse = { error: "Add text or up to 10 media files to your post." };
    res.status(400).json(response);
    return;
  }

  const { userId } = getAuthContext(res);
  const remixSourcePostId = parsed.data.remixSourcePostId || null;
  if (remixSourcePostId && !await visiblePostForRemix(remixSourcePostId, userId)) {
    res.status(404).json({ error: "The original post is unavailable or no longer visible." });
    return;
  }
  if (visibility === "close-friends") {
    const [member] = await db.select({ id: closeFriendMembersTable.memberId })
      .from(closeFriendMembersTable).where(eq(closeFriendMembersTable.ownerId, userId)).limit(1);
    if (!member) { res.status(400).json({ error: "Add at least one person to Close Friends first." }); return; }
  }
  if (mediaIds.length) {
    const ownedMedia = await db.select({ id: userMediaAssetsTable.id, contentType: userMediaAssetsTable.contentType }).from(userMediaAssetsTable).where(and(
      inArray(userMediaAssetsTable.id, mediaIds),
      eq(userMediaAssetsTable.userId, userId),
      eq(userMediaAssetsTable.ready, true),
    ));
    if (ownedMedia.length !== mediaIds.length || ownedMedia.some(media => !media.contentType.startsWith("image/") && !media.contentType.startsWith("video/"))) {
      res.status(400).json({ error: "Every post attachment must be confirmed in your account first." });
      return;
    }
  }
  let sportsCard: Record<string, unknown> | null = null;
  let sportsMediaType = "image";
  if (parsed.data.sportsCardId && !parsed.data.workoutId) { res.status(400).json({ error: "A card needs its workout." }); return; }
  if (parsed.data.workoutId) {
    const [workout] = await db.select().from(workoutsTable).where(and(
      eq(workoutsTable.id, parsed.data.workoutId), eq(workoutsTable.userId, userId))).limit(1);
    if (!workout) { res.status(404).json({ error: "Workout not found." }); return; }
    if (parsed.data.sportsCardId) {
      const [image] = await db.select().from(sportsMediaTable).where(and(
        eq(sportsMediaTable.id, parsed.data.sportsCardId), eq(sportsMediaTable.userId, userId), eq(sportsMediaTable.workoutId, workout.id))).limit(1);
      if (!image) { res.status(404).json({ error: "Card not found." }); return; }
      sportsMediaType = image.mime.startsWith("video/") ? "video" : "image";
    }
    sportsCard = { activityType: workout.recording.activityType, summary: workout.summary, imageId: parsed.data.sportsCardId || null,
      mediaType: sportsMediaType, ...await workoutTagData(workout.id, userId) };
  }
  const [created] = await db.transaction(async tx => {
    const [post] = await tx
      .insert(postsTable)
      .values({ authorId: userId, text, visibility, destination, place: place.data || null, sportsCard,
        remixSourcePostId, sportsWorkoutId: parsed.data.workoutId || null,
        ...(parsed.data.workoutId ? { sourceId: sportsPostSourceId(parsed.data.workoutId, parsed.data.sportsCardId) } : {}) })
      .onConflictDoUpdate({ target: [postsTable.authorId, postsTable.sourceId], set: { text, visibility, destination, sportsCard, remixSourcePostId } })
      .returning({ id: postsTable.id });
    await tx.delete(postMediaAssetsTable).where(eq(postMediaAssetsTable.postId, post.id));
    if (mediaIds.length) {
      await tx.insert(postMediaAssetsTable).values(mediaIds.map((mediaId, position) => ({
        postId: post.id, mediaId, position,
      })));
    }
    return [post];
  });
  const row = await getPostRow(created.id);
  if (!row) {
    throw new Error("Created post could not be loaded.");
  }

  const [post] = await postsForViewer([row], userId);
  const response: PostCreationResult = { post };
  res.status(201).json(response);
  refreshCreatorsAfterActivity([userId]);
});

router.post("/posts/import", requireAuth, async (req, res): Promise<void> => {
  const parsed = ImportLegacyPostsBody.safeParse(req.body);
  if (!parsed.success) {
    const response: ErrorResponse = { error: "The post import batch is invalid." };
    res.status(400).json(response);
    return;
  }

  const items = parsed.data.posts;
  const sourceIds = items.map((item) => item.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    const response: ErrorResponse = { error: "An import batch cannot contain duplicate post IDs." };
    res.status(400).json(response);
    return;
  }
  if (items.some(item => item.comments && new Set(item.comments.map(comment => comment.sourceId)).size !== item.comments.length)) {
    res.status(400).json({ error: "An imported post cannot contain duplicate legacy comment IDs." });
    return;
  }

  const { userId } = getAuthContext(res);
  const normalized = items.map(item => ({
    ...item,
    text: item.text.trim(),
    visibility: item.visibility || "public",
    mediaIds: [...new Set(item.mediaIds || [])],
  }));
  if (normalized.some(item => (!item.text && item.mediaIds.length === 0) ||
    item.text.length > 1000 || item.mediaIds.length > 10)) {
    res.status(400).json({ error: "Each imported post needs text or up to 10 media files." });
    return;
  }
  if (normalized.some(item => item.visibility === "close-friends")) {
    const [member] = await db.select({ id: closeFriendMembersTable.memberId })
      .from(closeFriendMembersTable).where(eq(closeFriendMembersTable.ownerId, userId)).limit(1);
    if (!member) { res.status(400).json({ error: "Add at least one person to Close Friends first." }); return; }
  }
  const allMediaIds = [...new Set(normalized.flatMap(item => item.mediaIds))];
  if (allMediaIds.length) {
    const ownedMedia = await db.select({ id: userMediaAssetsTable.id, contentType: userMediaAssetsTable.contentType })
      .from(userMediaAssetsTable).where(and(
        inArray(userMediaAssetsTable.id, allMediaIds),
        eq(userMediaAssetsTable.userId, userId),
        eq(userMediaAssetsTable.ready, true),
      ));
    if (ownedMedia.length !== allMediaIds.length ||
      ownedMedia.some(media => !media.contentType.startsWith("image/") && !media.contentType.startsWith("video/"))) {
      res.status(400).json({ error: "Every imported attachment must be confirmed in your account first." });
      return;
    }
  }
  const transfer = await db.transaction(async tx => {
    const created = await tx
      .insert(postsTable)
      .values(normalized.map(item => ({
        authorId: userId,
        sourceId: item.sourceId,
        text: item.text,
        visibility: item.visibility,
        createdAt: new Date(item.createdAt),
      })))
      .onConflictDoNothing({ target: [postsTable.authorId, postsTable.sourceId] })
      .returning({ id: postsTable.id, sourceId: postsTable.sourceId });
    const itemBySource = new Map(normalized.map(item => [item.sourceId, item]));
    for (const post of created) {
      const item = itemBySource.get(post.sourceId || "");
      if (item?.mediaIds.length) {
        await tx.insert(postMediaAssetsTable).values(item.mediaIds.map((mediaId, position) => ({
          postId: post.id, mediaId, position,
        })));
      }
    }
    const existing = await tx.select({
      id: postsTable.id,
      sourceId: postsTable.sourceId,
      remixSourcePostId: postsTable.remixSourcePostId,
      text: postsTable.text,
      visibility: postsTable.visibility,
      createdAt: postsTable.createdAt,
    }).from(postsTable).where(and(
      eq(postsTable.authorId, userId),
      inArray(postsTable.sourceId, sourceIds),
    ));
    const createdIds = new Set(created.map(post => post.id));
    const existingMedia = existing.length ? await tx.select({
      postId: postMediaAssetsTable.postId,
      mediaId: postMediaAssetsTable.mediaId,
    }).from(postMediaAssetsTable).where(inArray(postMediaAssetsTable.postId, existing.map(post => post.id))) : [];
    const mediaByPost = new Map<string, string[]>();
    for (const row of existingMedia) {
      mediaByPost.set(row.postId, [...(mediaByPost.get(row.postId) || []), row.mediaId]);
    }
    const postBySource = new Map(existing.map(post => [post.sourceId, post]));
    for (const item of normalized) {
      const post = postBySource.get(item.sourceId);
      if (!post || createdIds.has(post.id) || !item.mediaIds.length) continue;
      const samePost = post.text === item.text &&
        post.visibility === item.visibility &&
        post.createdAt.getTime() === item.createdAt;
      if (!samePost || (mediaByPost.get(post.id) || []).length) continue;
      // Repair an interrupted earlier import only when source identity still matches
      // and the server post has no attachments. Never replace existing published media.
      await tx.insert(postMediaAssetsTable).values(item.mediaIds.map((mediaId, position) => ({
        postId: post.id, mediaId, position,
      }))).onConflictDoNothing();
      mediaByPost.set(post.id, [...item.mediaIds]);
    }
    const postIdBySource = new Map(existing.map(post => [post.sourceId, post.id]));
    const trusted = normalized.filter(item => {
      const post = postBySource.get(item.sourceId);
      return Boolean(post &&
        post.text === item.text &&
        post.visibility === item.visibility &&
        post.createdAt.getTime() === item.createdAt &&
        JSON.stringify(mediaByPost.get(post.id) || []) === JSON.stringify(item.mediaIds));
    });
    const trustedSources = new Set(trusted.map(item => item.sourceId));
    const likedPostIds = trusted
      .filter(item => item.likedByMe === true)
      .map(item => postIdBySource.get(item.sourceId))
      .filter((id): id is string => Boolean(id));
    if (likedPostIds.length) {
      await tx.insert(postLikesTable).values(likedPostIds.map(postId => ({ userId, postId }))).onConflictDoNothing();
    }
    const savedPostIds = trusted
      .filter(item => item.savedByMe === true)
      .map(item => postIdBySource.get(item.sourceId))
      .filter((id): id is string => Boolean(id));
    const importedComments = trusted.flatMap(item => {
      const postId = postIdBySource.get(item.sourceId);
      if (!postId) return [];
      const sourceComments = item.comments || [];
      const sourceCommentIds = new Set(sourceComments.map(comment => comment.sourceId));
      return sourceComments.map(comment => ({
        id: legacyCommentUuid(userId, item.sourceId, comment.sourceId),
        postId,
        userId,
        parentId: comment.parentSourceId && sourceCommentIds.has(comment.parentSourceId)
          ? legacyCommentUuid(userId, item.sourceId, comment.parentSourceId)
          : null,
        body: comment.body,
        createdAt: new Date(comment.createdAt),
      }));
    });
    if (importedComments.length) {
      await tx.insert(postCommentsTable).values(importedComments).onConflictDoNothing();
    }
    const archiveUpdates = trusted.flatMap(item => {
      const archive = item.legacyArchive;
      if (!archive || (!archive.legacyLikes.length && !archive.legacySaves.length && !archive.comments.length)) return [];
      return [{
        sourcePostId: item.sourceId,
        legacyLikes: [...new Set(archive.legacyLikes)],
        legacySaves: [...new Set(archive.legacySaves)],
        comments: archive.comments,
      }];
    });
    if (savedPostIds.length || archiveUpdates.length) {
      const [stateRow] = await tx.select({ data: accountStateTable.data })
        .from(accountStateTable)
        .where(eq(accountStateTable.userId, userId))
        .limit(1);
      const state = stateRow?.data && typeof stateRow.data === "object" && !Array.isArray(stateRow.data)
        ? stateRow.data as Record<string, unknown>
        : {};
      const saved = Array.isArray(state.savedPostIds)
        ? state.savedPostIds.filter((id): id is string => typeof id === "string")
        : [];
      const currentArchives = Array.isArray(state.legacyPostArchives)
        ? state.legacyPostArchives.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
        : [];
      const archiveBySource = new Map(
        currentArchives
          .filter(entry => typeof entry.sourcePostId === "string")
          .map(entry => [entry.sourcePostId as string, entry]),
      );
      for (const archive of archiveUpdates) archiveBySource.set(archive.sourcePostId, archive);
      const nextState = {
        ...state,
        ...(savedPostIds.length ? { savedPostIds: [...new Set([...saved, ...savedPostIds])] } : {}),
        ...(archiveUpdates.length ? { legacyPostArchives: [...archiveBySource.values()] } : {}),
      };
      if (Buffer.byteLength(JSON.stringify(nextState)) > 256 * 1024) {
        throw new Error("The private legacy post archive is too large to verify in account storage. The original copy was kept.");
      }
      await tx.insert(accountStateTable).values({ userId, data: nextState, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: accountStateTable.userId,
          set: { data: nextState, updatedAt: new Date() },
        });
    }
    return { created, trustedSources: [...trustedSources] };
  });
  const insertedIds = new Set(transfer.created.map((post) => post.sourceId));
  const trustedSources = new Set(transfer.trustedSources);
  const persisted = await db
    .select({
      id: postsTable.id,
      sourceId: postsTable.sourceId,
      text: postsTable.text,
      visibility: postsTable.visibility,
    })
    .from(postsTable)
    .where(
      and(
        eq(postsTable.authorId, userId),
        inArray(postsTable.sourceId, sourceIds),
      ),
    );
  const bySourceId = new Map(persisted.map((post) => [post.sourceId, post]));
  const postIds = persisted.map(post => post.id);
  const persistedIdBySource = new Map(persisted.map(post => [post.sourceId, post.id]));
  const trustedItems = normalized.filter(item => trustedSources.has(item.sourceId));
  const likedPostIds = trustedItems
    .filter(item => item.likedByMe === true)
    .map(item => persistedIdBySource.get(item.sourceId))
    .filter((id): id is string => Boolean(id));
  if (likedPostIds.length) {
    const confirmedLikes = await db.select({ postId: postLikesTable.postId })
      .from(postLikesTable)
      .where(and(
        eq(postLikesTable.userId, userId),
        inArray(postLikesTable.postId, likedPostIds),
      ));
    if (new Set(confirmedLikes.map(row => row.postId)).size !== new Set(likedPostIds).size) {
      throw new Error("The server could not verify every imported post like.");
    }
  }
  const savedPostIds = trustedItems
    .filter(item => item.savedByMe === true)
    .map(item => persistedIdBySource.get(item.sourceId))
    .filter((id): id is string => Boolean(id));
  if (savedPostIds.length) {
    const [stateRow] = await db.select({ data: accountStateTable.data })
      .from(accountStateTable)
      .where(eq(accountStateTable.userId, userId))
      .limit(1);
    const confirmedSavedIds = new Set(
      stateRow?.data && typeof stateRow.data === "object" && !Array.isArray(stateRow.data) &&
      Array.isArray((stateRow.data as Record<string, unknown>).savedPostIds)
        ? (stateRow.data as Record<string, unknown>).savedPostIds as string[]
        : [],
    );
    if (savedPostIds.some(id => !confirmedSavedIds.has(id))) {
      throw new Error("The server could not verify every imported saved post.");
    }
  }
  const expectedCommentIds = trustedItems.flatMap(item =>
    (item.comments || []).map(comment => legacyCommentUuid(userId, item.sourceId, comment.sourceId)));
  if (expectedCommentIds.length) {
    const confirmedComments = await db.select({ id: postCommentsTable.id })
      .from(postCommentsTable)
      .where(inArray(postCommentsTable.id, expectedCommentIds));
    if (new Set(confirmedComments.map(row => row.id)).size !== new Set(expectedCommentIds).size) {
      throw new Error("The server could not verify every imported post comment.");
    }
  }
  const expectedArchives = trustedItems
    .filter(item => item.legacyArchive &&
      (item.legacyArchive.legacyLikes.length || item.legacyArchive.legacySaves.length || item.legacyArchive.comments.length))
    .map(item => item.sourceId);
  if (expectedArchives.length) {
    const [stateRow] = await db.select({ data: accountStateTable.data })
      .from(accountStateTable)
      .where(eq(accountStateTable.userId, userId))
      .limit(1);
    const archives = stateRow?.data && typeof stateRow.data === "object" && !Array.isArray(stateRow.data) &&
      Array.isArray((stateRow.data as Record<string, unknown>).legacyPostArchives)
      ? (stateRow.data as Record<string, unknown>).legacyPostArchives as Array<{ sourcePostId?: string }>
      : [];
    const confirmedSources = new Set(archives.map(entry => entry?.sourcePostId));
    if (expectedArchives.some(sourceId => !confirmedSources.has(sourceId))) {
      throw new Error("The server could not verify every private legacy post archive.");
    }
  }
  const mediaRows = postIds.length ? await db.select({
    postId: postMediaAssetsTable.postId,
    mediaId: postMediaAssetsTable.mediaId,
    position: postMediaAssetsTable.position,
  }).from(postMediaAssetsTable).where(inArray(postMediaAssetsTable.postId, postIds))
    .orderBy(postMediaAssetsTable.position) : [];
  const mediaByPost = new Map<string, string[]>();
  for (const row of mediaRows) mediaByPost.set(row.postId, [...(mediaByPost.get(row.postId) || []), row.mediaId]);
  const results = normalized.map((item) => {
    const saved = bySourceId.get(item.sourceId);
    if (!saved) {
      throw new Error("An imported post could not be confirmed after saving.");
    }
    const mediaMatches = JSON.stringify(mediaByPost.get(saved.id) || []) === JSON.stringify(item.mediaIds);
    const contentMatches = saved.text === item.text && saved.visibility === item.visibility && mediaMatches;
    return {
      sourceId: item.sourceId,
      postId: saved.id,
      outcome: insertedIds.has(item.sourceId)
        ? "imported" as const
        : contentMatches
          ? "already-imported" as const
          : "conflict" as const,
    };
  });
  const response: PostImportResponse = { results };
  res.json(response);
  refreshCreatorsAfterActivity([userId]);
});

router.put("/posts/:id/like", requireAuth, async (req, res): Promise<void> => {
  const params = LikePostParams.safeParse(req.params);
  if (!params.success) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  const { userId } = getAuthContext(res);
  const [post] = await db
    .select({ id: postsTable.id, authorId: postsTable.authorId })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.id))
    .limit(1);
  if (!post) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  await db
    .insert(postLikesTable)
    .values({ userId, postId: params.data.id })
    .onConflictDoNothing();
  const response: LikeResponse = {
    liked: true,
    likeCount: await currentLikeCount(params.data.id),
  };
  res.json(response);
  refreshCreatorsAfterActivity([userId, post.authorId]);
  if (userId !== post.authorId) notifyAccountActivity(post.authorId);
});

router.delete("/posts/:id/like", requireAuth, async (req, res): Promise<void> => {
  const params = UnlikePostParams.safeParse(req.params);
  if (!params.success) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  const { userId } = getAuthContext(res);
  const [post] = await db
    .select({ id: postsTable.id })
    .from(postsTable)
    .where(eq(postsTable.id, params.data.id))
    .limit(1);
  if (!post) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  await db
    .delete(postLikesTable)
    .where(
      and(
        eq(postLikesTable.userId, userId),
        eq(postLikesTable.postId, params.data.id),
      ),
    );
  const response: LikeResponse = {
    liked: false,
    likeCount: await currentLikeCount(params.data.id),
  };
  res.json(response);
});

router.put("/posts/:id/repost", requireAuth, async (req, res): Promise<void> => {
  const params = RepostPostParams.safeParse(req.params);
  const parsed = RepostPostBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Repost notes must be 140 characters or fewer." });
    return;
  }

  const { userId } = getAuthContext(res);
  const post = await visiblePostForRepost(params.data.id, userId);
  if (!post) {
    res.status(404).json({ error: "Post not found or not visible." });
    return;
  }

  const note = String(parsed.data.note || "").trim();
  const [repost] = await db
    .insert(postRepostsTable)
    .values({ postId: post.id, userId, note })
    .onConflictDoUpdate({
      target: [postRepostsTable.postId, postRepostsTable.userId],
      set: { note, updatedAt: new Date() },
    })
    .returning({ note: postRepostsTable.note });
  const response = RepostPostResponse.parse({
    reposted: true,
    repostCount: await currentRepostCount(post.id),
    note: repost.note,
  });
  res.json(response);
  refreshCreatorsAfterActivity([userId, post.authorId]);
  if (userId !== post.authorId) notifyAccountActivity(post.authorId);
});

router.delete("/posts/:id/repost", requireAuth, async (req, res): Promise<void> => {
  const params = RemovePostRepostParams.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "Post not found or not visible." });
    return;
  }

  const { userId } = getAuthContext(res);
  const post = await visiblePostForRepost(params.data.id, userId);
  if (!post) {
    res.status(404).json({ error: "Post not found or not visible." });
    return;
  }

  await db.delete(postRepostsTable).where(and(
    eq(postRepostsTable.postId, post.id),
    eq(postRepostsTable.userId, userId),
  ));
  const response = RemovePostRepostResponse.parse({
    reposted: false,
    repostCount: await currentRepostCount(post.id),
    note: null,
  });
  res.json(response);
});

router.delete("/posts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeletePostParams.safeParse(req.params);
  if (!params.success) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  const { userId } = getAuthContext(res);
  const [deleted] = await db
    .delete(postsTable)
    .where(
      and(
        eq(postsTable.id, params.data.id),
        eq(postsTable.authorId, userId),
      ),
    )
    .returning({ id: postsTable.id });

  if (!deleted) {
    const response: ErrorResponse = { error: "Post not found." };
    res.status(404).json(response);
    return;
  }

  res.status(204).end();
});

router.get("/relationships", requireAuth, async (_req, res): Promise<void> => {
  const { userId } = getAuthContext(res);
  const [followingRows, followerRows, friendRows, incomingFriendRows, outgoingFriendRows, incomingFollowRows, outgoingFollowRows] =
    await Promise.all([
      db.select({ id: userFollowsTable.followedId }).from(userFollowsTable)
        .where(eq(userFollowsTable.followerId, userId)).orderBy(desc(userFollowsTable.createdAt)).limit(5000),
      db.select({ id: userFollowsTable.followerId }).from(userFollowsTable)
        .where(eq(userFollowsTable.followedId, userId)).orderBy(desc(userFollowsTable.createdAt)).limit(5000),
      db.select({
        low: friendshipsTable.memberLowId,
        high: friendshipsTable.memberHighId,
      }).from(friendshipsTable).where(
        or(eq(friendshipsTable.memberLowId, userId), eq(friendshipsTable.memberHighId, userId)),
      ).orderBy(desc(friendshipsTable.createdAt)).limit(5000),
      db.select({ id: friendRequestsTable.requesterId }).from(friendRequestsTable)
        .where(eq(friendRequestsTable.recipientId, userId)).orderBy(desc(friendRequestsTable.createdAt)).limit(500),
      db.select({ id: friendRequestsTable.recipientId }).from(friendRequestsTable)
        .where(eq(friendRequestsTable.requesterId, userId)).orderBy(desc(friendRequestsTable.createdAt)).limit(500),
      db.select({ id: followRequestsTable.requesterId }).from(followRequestsTable)
        .where(eq(followRequestsTable.recipientId, userId)).orderBy(desc(followRequestsTable.createdAt)).limit(500),
      db.select({ id: followRequestsTable.recipientId }).from(followRequestsTable)
        .where(eq(followRequestsTable.requesterId, userId)).orderBy(desc(followRequestsTable.createdAt)).limit(500),
    ]);
  const friendIds = friendRows.map(row => row.low === userId ? row.high : row.low);
  const ids = [
    ...followingRows.map(row => row.id), ...followerRows.map(row => row.id), ...friendIds,
    ...incomingFriendRows.map(row => row.id), ...outgoingFriendRows.map(row => row.id),
    ...incomingFollowRows.map(row => row.id), ...outgoingFollowRows.map(row => row.id),
  ];
  const profiles = await relationshipProfiles(ids);
  const list = (values: string[]) => values.flatMap(id => {
    const profile = profiles.get(id);
    return profile ? [profile] : [];
  });
  res.json({
    following: list(followingRows.map(row => row.id)),
    followers: list(followerRows.map(row => row.id)),
    friends: list(friendIds),
    incomingFriendRequests: list(incomingFriendRows.map(row => row.id)),
    outgoingFriendRequests: list(outgoingFriendRows.map(row => row.id)),
    incomingFollowRequests: list(incomingFollowRows.map(row => row.id)),
    outgoingFollowRequests: list(outgoingFollowRows.map(row => row.id)),
  });
});

router.post("/relationships/import-legacy", requireAuth, async (req, res): Promise<void> => {
  const parsed = z.object({
    followingIds: z.array(z.string().uuid()).max(2000).default([]),
    friendIds: z.array(z.string().uuid()).max(2000).default([]),
    outgoingFriendRequestIds: z.array(z.string().uuid()).max(2000).default([]),
    outgoingFollowRequestIds: z.array(z.string().uuid()).max(2000).default([]),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The saved relationship data could not be migrated." });
    return;
  }
  const { userId } = getAuthContext(res);
  const imported = await db.transaction(async tx => {
    const [marker] = await tx.insert(relationshipMigrationsTable).values({ userId })
      .onConflictDoNothing().returning({ userId: relationshipMigrationsTable.userId });
    if (!marker) return { imported: false, migratedTargets: 0 };

    const data = parsed.data;
    const allIds = [...new Set([
      ...data.followingIds,
      ...data.friendIds,
      ...data.outgoingFriendRequestIds,
      ...data.outgoingFollowRequestIds,
    ])].filter(id => id !== userId);
    if (!allIds.length) return { imported: true, migratedTargets: 0 };

    const profiles = await tx.select({ id: usersTable.id, isPrivate: usersTable.isPrivate })
      .from(usersTable).where(inArray(usersTable.id, allIds));
    const profileById = new Map(profiles.map(profile => [profile.id, profile]));
    const blockedRows = await tx.select({
      ownerId: accountBlocksTable.ownerId,
      blockedId: accountBlocksTable.blockedId,
    }).from(accountBlocksTable).where(or(
      and(eq(accountBlocksTable.ownerId, userId), inArray(accountBlocksTable.blockedId, allIds)),
      and(inArray(accountBlocksTable.ownerId, allIds), eq(accountBlocksTable.blockedId, userId)),
    ));
    const blockedIds = new Set(blockedRows.flatMap(row => [row.ownerId, row.blockedId]));
    let migratedTargets = 0;

    const importFollow = async (targetId: string) => {
      const target = profileById.get(targetId);
      if (!target || blockedIds.has(targetId)) return;
      if (target.isPrivate) {
        await tx.insert(followRequestsTable).values({ requesterId: userId, recipientId: targetId }).onConflictDoNothing();
      } else {
        await tx.insert(userFollowsTable).values({ followerId: userId, followedId: targetId }).onConflictDoNothing();
      }
      migratedTargets++;
    };
    for (const targetId of new Set([...data.followingIds, ...data.outgoingFollowRequestIds])) {
      await importFollow(targetId);
    }

    const importFriendRequest = async (targetId: string) => {
      if (!profileById.has(targetId) || blockedIds.has(targetId)) return;
      const pair = orderedFriendIds(userId, targetId);
      const [alreadyFriends] = await tx.select({ id: friendshipsTable.memberLowId }).from(friendshipsTable)
        .where(and(
          eq(friendshipsTable.memberLowId, pair.memberLowId),
          eq(friendshipsTable.memberHighId, pair.memberHighId),
        )).limit(1);
      if (alreadyFriends) return;
      const [incoming] = await tx.select({ id: friendRequestsTable.requesterId }).from(friendRequestsTable)
        .where(and(
          eq(friendRequestsTable.requesterId, targetId),
          eq(friendRequestsTable.recipientId, userId),
        )).limit(1);
      if (incoming) {
        await tx.insert(friendshipsTable).values(pair).onConflictDoNothing();
        await tx.delete(friendRequestsTable).where(or(
          and(eq(friendRequestsTable.requesterId, userId), eq(friendRequestsTable.recipientId, targetId)),
          and(eq(friendRequestsTable.requesterId, targetId), eq(friendRequestsTable.recipientId, userId)),
        ));
      } else {
        await tx.insert(friendRequestsTable).values({ requesterId: userId, recipientId: targetId }).onConflictDoNothing();
      }
      migratedTargets++;
    };
    for (const targetId of new Set([...data.friendIds, ...data.outgoingFriendRequestIds])) {
      await importFriendRequest(targetId);
    }
    return { imported: true, migratedTargets };
  });
  res.json(imported);
});

router.post("/relationships/follow/:targetId", requireAuth, async (req, res): Promise<void> => {
  const targetId = String(req.params.targetId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId) || targetId === userId) {
    res.status(400).json({ error: "Choose a valid account to follow." });
    return;
  }
  const [target] = await db.select({ id: usersTable.id, isPrivate: usersTable.isPrivate })
    .from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (await blockedPair(userId, targetId)) {
    res.status(403).json({ error: "This account cannot be followed." });
    return;
  }
  if (target.isPrivate) {
    await db.insert(followRequestsTable).values({ requesterId: userId, recipientId: targetId }).onConflictDoNothing();
    notifyAccountActivity(targetId);
    res.json({ following: false, requested: true });
    return;
  }
  await db.transaction(async tx => {
    await tx.delete(followRequestsTable).where(
      and(eq(followRequestsTable.requesterId, userId), eq(followRequestsTable.recipientId, targetId)),
    );
    await tx.insert(userFollowsTable).values({ followerId: userId, followedId: targetId }).onConflictDoNothing();
  });
  res.json({ following: true, requested: false });
  notifyAccountActivity(targetId);
});

router.delete("/relationships/follow/:targetId", requireAuth, async (req, res): Promise<void> => {
  const targetId = String(req.params.targetId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId) || targetId === userId) {
    res.status(400).json({ error: "Choose a valid account." });
    return;
  }
  await db.transaction(async tx => {
    await tx.delete(userFollowsTable).where(
      and(eq(userFollowsTable.followerId, userId), eq(userFollowsTable.followedId, targetId)),
    );
    await tx.delete(followRequestsTable).where(
      and(eq(followRequestsTable.requesterId, userId), eq(followRequestsTable.recipientId, targetId)),
    );
  });
  res.status(204).end();
});

router.post("/relationships/follow-requests/:requesterId/accept", requireAuth, async (req, res): Promise<void> => {
  const requesterId = String(req.params.requesterId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requesterId) || requesterId === userId) {
    res.status(400).json({ error: "Choose a valid follow request." });
    return;
  }
  if (await blockedPair(userId, requesterId)) {
    res.status(403).json({ error: "This follow request cannot be accepted." });
    return;
  }
  const [request] = await db.select({ requesterId: followRequestsTable.requesterId })
    .from(followRequestsTable)
    .where(and(
      eq(followRequestsTable.requesterId, requesterId),
      eq(followRequestsTable.recipientId, userId),
    )).limit(1);
  if (!request) {
    res.status(404).json({ error: "Follow request not found." });
    return;
  }
  await db.transaction(async tx => {
    await tx.insert(userFollowsTable).values({ followerId: requesterId, followedId: userId }).onConflictDoNothing();
    await tx.delete(followRequestsTable).where(
      and(eq(followRequestsTable.requesterId, requesterId), eq(followRequestsTable.recipientId, userId)),
    );
  });
  res.status(204).end();
});

router.delete("/relationships/follow-requests/:requesterId", requireAuth, async (req, res): Promise<void> => {
  const requesterId = String(req.params.requesterId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requesterId) || requesterId === userId) {
    res.status(400).json({ error: "Choose a valid follow request." });
    return;
  }
  await db.delete(followRequestsTable).where(or(
    and(eq(followRequestsTable.requesterId, requesterId), eq(followRequestsTable.recipientId, userId)),
    and(eq(followRequestsTable.requesterId, userId), eq(followRequestsTable.recipientId, requesterId)),
  ));
  res.status(204).end();
});

router.post("/relationships/friend-requests/:targetId", requireAuth, async (req, res): Promise<void> => {
  const targetId = String(req.params.targetId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId) || targetId === userId) {
    res.status(400).json({ error: "Choose a valid account to add as a Friend." });
    return;
  }
  const [target] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(eq(usersTable.id, targetId)).limit(1);
  if (!target) {
    res.status(404).json({ error: "Account not found." });
    return;
  }
  if (await blockedPair(userId, targetId)) {
    res.status(403).json({ error: "This account cannot be added as a Friend." });
    return;
  }
  const pair = orderedFriendIds(userId, targetId);
  const [friendship] = await db.select({ id: friendshipsTable.memberLowId }).from(friendshipsTable)
    .where(and(
      eq(friendshipsTable.memberLowId, pair.memberLowId),
      eq(friendshipsTable.memberHighId, pair.memberHighId),
    )).limit(1);
  if (friendship) {
    res.json({ status: "friends" });
    notifyAccountActivity(targetId);
    notifyAccountActivity(userId);
    return;
  }
  const [incoming] = await db.select({ id: friendRequestsTable.requesterId }).from(friendRequestsTable)
    .where(and(
      eq(friendRequestsTable.requesterId, targetId),
      eq(friendRequestsTable.recipientId, userId),
    )).limit(1);
  if (incoming) {
    await db.transaction(async tx => {
      await tx.insert(friendshipsTable).values(pair).onConflictDoNothing();
      await tx.delete(friendRequestsTable).where(or(
        and(eq(friendRequestsTable.requesterId, userId), eq(friendRequestsTable.recipientId, targetId)),
        and(eq(friendRequestsTable.requesterId, targetId), eq(friendRequestsTable.recipientId, userId)),
      ));
    });
    res.json({ status: "friends" });
    return;
  }
  await db.insert(friendRequestsTable).values({ requesterId: userId, recipientId: targetId }).onConflictDoNothing();
  notifyAccountActivity(targetId);
  res.json({ status: "requested" });
});

router.post("/relationships/friend-requests/:requesterId/accept", requireAuth, async (req, res): Promise<void> => {
  const requesterId = String(req.params.requesterId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requesterId) || requesterId === userId) {
    res.status(400).json({ error: "Choose a valid Friend request." });
    return;
  }
  if (await blockedPair(userId, requesterId)) {
    res.status(403).json({ error: "This Friend request cannot be accepted." });
    return;
  }
  const [request] = await db.select({ id: friendRequestsTable.requesterId }).from(friendRequestsTable)
    .where(and(
      eq(friendRequestsTable.requesterId, requesterId),
      eq(friendRequestsTable.recipientId, userId),
    )).limit(1);
  if (!request) {
    res.status(404).json({ error: "Friend request not found." });
    return;
  }
  const pair = orderedFriendIds(userId, requesterId);
  await db.transaction(async tx => {
    await tx.insert(friendshipsTable).values(pair).onConflictDoNothing();
    await tx.delete(friendRequestsTable).where(or(
      and(eq(friendRequestsTable.requesterId, requesterId), eq(friendRequestsTable.recipientId, userId)),
      and(eq(friendRequestsTable.requesterId, userId), eq(friendRequestsTable.recipientId, requesterId)),
    ));
  });
  res.status(204).end();
  notifyAccountActivity(requesterId);
  notifyAccountActivity(userId);
});

router.delete("/relationships/friend-requests/:otherId", requireAuth, async (req, res): Promise<void> => {
  const otherId = String(req.params.otherId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(otherId) || otherId === userId) {
    res.status(400).json({ error: "Choose a valid Friend request." });
    return;
  }
  await db.delete(friendRequestsTable).where(or(
    and(eq(friendRequestsTable.requesterId, userId), eq(friendRequestsTable.recipientId, otherId)),
    and(eq(friendRequestsTable.requesterId, otherId), eq(friendRequestsTable.recipientId, userId)),
  ));
  res.status(204).end();
});

router.delete("/relationships/friends/:friendId", requireAuth, async (req, res): Promise<void> => {
  const friendId = String(req.params.friendId || "");
  const { userId } = getAuthContext(res);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(friendId) || friendId === userId) {
    res.status(400).json({ error: "Choose a valid Friend." });
    return;
  }
  const pair = orderedFriendIds(userId, friendId);
  await db.transaction(async tx => {
    await tx.delete(friendshipsTable).where(and(
      eq(friendshipsTable.memberLowId, pair.memberLowId),
      eq(friendshipsTable.memberHighId, pair.memberHighId),
    ));
    await tx.delete(friendRequestsTable).where(or(
      and(eq(friendRequestsTable.requesterId, userId), eq(friendRequestsTable.recipientId, friendId)),
      and(eq(friendRequestsTable.requesterId, friendId), eq(friendRequestsTable.recipientId, userId)),
    ));
  });
  res.status(204).end();
});

router.get("/users/search", requireAuth, async (req, res): Promise<void> => {
  const params = SearchUsersQueryParams.safeParse(req.query);
  const query = params.success ? params.data.query.trim() : "";
  if (!params.success || query.length < 2) {
    const response: ErrorResponse = { error: "Enter at least two characters to search." };
    res.status(400).json(response);
    return;
  }

  const pattern = query.replace(/[\\%_]/g, "\\$&");
  const users = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(
      or(
        ilike(usersTable.username, `%${pattern}%`),
        ilike(usersTable.displayName, `%${pattern}%`),
      ),
    )
    .orderBy(
      sql`case when lower(${usersTable.username}) = lower(${query}) then 0 else 1 end`,
      usersTable.username,
    )
    .limit(MAX_SEARCH_RESULTS);

  const details = await publicProfileDetails(users.map(user => user.id), getAuthContext(res).userId);
  const response: UserSearchResults = {
    profiles: users.map(user => ({ ...publicProfile(user), ...details.get(user.id) })),
  };
  res.json(response);
});

router.get("/profiles/:username", requireAuth, async (req, res): Promise<void> => {
  const params = GetUserProfileParams.safeParse(req.params);
  if (!params.success) {
    const response: ErrorResponse = { error: "Profile not found." };
    res.status(404).json(response);
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.username, params.data.username.toLowerCase()))
    .limit(1);
  if (!user) {
    const response: ErrorResponse = { error: "Profile not found." };
    res.status(404).json(response);
    return;
  }

  const { userId: viewerId } = getAuthContext(res);
  const [countResult, rows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(postsTable)
      .where(and(eq(postsTable.authorId, user.id), postVisibilityForViewer(viewerId))),
    listPostRows(MAX_PROFILE_POSTS, viewerId, user.id),
  ]);
  const response: ProfileResponse = {
    profile: { ...publicProfile(user), ...(await publicProfileDetails([user.id], viewerId)).get(user.id) },
    posts: await postsForViewer(rows, viewerId),
    postCount: Number(countResult[0]?.count ?? 0),
  };
  res.json(response);
});

router.get("/profiles/:username/reposts", requireAuth, async (req, res): Promise<void> => {
  const profileParams = GetUserProfileParams.safeParse(req.params);
  const pageParams = ListFeedQueryParams.safeParse(req.query);
  if (!profileParams.success || !pageParams.success) {
    const response: ErrorResponse = { error: "The repost list request is invalid." };
    res.status(400).json(response);
    return;
  }

  const [profile] = await db
    .select({ id: usersTable.id, isPrivate: usersTable.isPrivate })
    .from(usersTable)
    .where(eq(usersTable.username, profileParams.data.username.toLowerCase()))
    .limit(1);
  if (!profile) {
    const response: ErrorResponse = { error: "Profile not found." };
    res.status(404).json(response);
    return;
  }

  const { userId: viewerId } = getAuthContext(res);
  if (await blockedPair(viewerId, profile.id)) {
    const response: ErrorResponse = { error: "Profile not found." };
    res.status(404).json(response);
    return;
  }
  if (profile.isPrivate && viewerId !== profile.id) {
    const pair = orderedFriendIds(viewerId, profile.id);
    const [follow, friendship, closeFriend] = await Promise.all([
      db.select({ id: userFollowsTable.followedId }).from(userFollowsTable)
        .where(and(eq(userFollowsTable.followerId, viewerId), eq(userFollowsTable.followedId, profile.id))).limit(1),
      db.select({ id: friendshipsTable.memberLowId }).from(friendshipsTable)
        .where(and(eq(friendshipsTable.memberLowId, pair.memberLowId), eq(friendshipsTable.memberHighId, pair.memberHighId))).limit(1),
      db.select({ id: closeFriendMembersTable.memberId }).from(closeFriendMembersTable)
        .where(and(eq(closeFriendMembersTable.ownerId, profile.id), eq(closeFriendMembersTable.memberId, viewerId))).limit(1),
    ]);
    if (!follow.length && !friendship.length && !closeFriend.length) {
      const response: ErrorResponse = { error: "Profile not found." };
      res.status(404).json(response);
      return;
    }
  }

  const limit = Math.min(pageParams.data.limit ?? 30, MAX_PROFILE_POSTS);
  const offset = pageParams.data.offset ?? 0;
  const rows = await db
    .select({
      id: postsTable.id,
      sourceId: postsTable.sourceId,
      remixSourcePostId: postsTable.remixSourcePostId,
      text: postsTable.text,
      visibility: postsTable.visibility,
      destination: postsTable.destination,
      place: postsTable.place,
      sportsCard: postsTable.sportsCard,
      createdAt: postsTable.createdAt,
      authorId: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      joinedAt: usersTable.createdAt,
    })
    .from(postRepostsTable)
    .innerJoin(postsTable, eq(postRepostsTable.postId, postsTable.id))
    .innerJoin(usersTable, eq(postsTable.authorId, usersTable.id))
    .where(and(
      eq(postRepostsTable.userId, profile.id),
      postVisibilityForViewer(viewerId),
      sql`NOT EXISTS (
        SELECT 1 FROM ${accountBlocksTable} AS b
        WHERE (b.owner_id = ${viewerId} AND b.blocked_id = ${usersTable.id})
          OR (b.owner_id = ${usersTable.id} AND b.blocked_id = ${viewerId})
      )`,
    ))
    .orderBy(desc(postRepostsTable.updatedAt), desc(postsTable.id))
    .limit(limit + 1)
    .offset(offset);
  const pageRows = rows.slice(0, limit);
  const response: FeedResponse = {
    posts: await postsForViewer(pageRows, viewerId),
    hasMore: rows.length > limit,
    nextOffset: offset + pageRows.length,
  };
  res.json(response);
});

export default router;
