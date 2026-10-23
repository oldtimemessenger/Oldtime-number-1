// A published export is a snapshot, not a mutable "latest media" workout post.
// Retrying the same export is idempotent; a different export gets its own post.
export function sportsPostSourceId(workoutId: string, mediaId?: string | null) {
  return `sports:${workoutId}:${mediaId || "summary"}`;
}
