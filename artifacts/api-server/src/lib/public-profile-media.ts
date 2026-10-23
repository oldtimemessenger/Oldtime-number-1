import { and, eq, inArray, or } from "drizzle-orm";
import { accountBlocksTable, accountStateTable, db } from "@workspace/db";
import type { PublicProfile } from "@workspace/api-zod";

// Deliberately exclude email, birthday, saved items, preferences and private lists.
export async function publicProfileDetails(ownerIds: string[], viewerId: string) {
  const ids = [...new Set(ownerIds)];
  const result = new Map<string, Partial<PublicProfile>>();
  if (!ids.length) return result;
  const [states, blocks] = await Promise.all([
    db.select().from(accountStateTable).where(inArray(accountStateTable.userId, ids)),
    db.select().from(accountBlocksTable).where(or(
      and(eq(accountBlocksTable.ownerId, viewerId), inArray(accountBlocksTable.blockedId, ids)),
      and(inArray(accountBlocksTable.ownerId, ids), eq(accountBlocksTable.blockedId, viewerId)),
    )),
  ]);
  const blocked = new Set(blocks.map(row =>
    row.ownerId === viewerId ? row.blockedId : row.ownerId));
  for (const state of states) {
    if (blocked.has(state.userId)) continue;
    const profile = state.data?.profile as Record<string, unknown> | undefined;
    if (!profile || typeof profile !== "object") continue;
    const visibility = profile.profileVisibility as Record<string, unknown> | undefined;
    result.set(state.userId, {
      ...(typeof profile.avatar === "string" ? { avatar: profile.avatar } : {}),
      ...(typeof profile.cover === "string" || profile.cover === null ? { cover: profile.cover } : {}),
      ...(typeof profile.bio === "string" ? { bio: profile.bio } : {}),
      ...(visibility?.city !== false && typeof profile.city === "string" ? { city: profile.city } : {}),
      ...(visibility?.interests !== false && Array.isArray(profile.interests)
        ? { interests: profile.interests.filter((item): item is string => typeof item === "string") } : {}),
    });
  }
  return result;
}
