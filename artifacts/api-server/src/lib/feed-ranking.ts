export type FeedSurface = "main" | "community" | "following" | "community-following";

export type FeedRankingCandidate = {
  id: string;
  authorId: string;
  createdAt: number;
  text: string;
  likeCount: number;
  repostCount: number;
  distinctCommenters: number;
  followedAuthor: boolean;
  likedByMe: boolean;
  repostedByMe: boolean;
  watchProgress: number;
  qualifiedViewRecently: boolean;
  interestMatches: number;
};

function baseScore(candidate: FeedRankingCandidate, surface: FeedSurface, now: number) {
  const communitySurface = surface === "community" || surface === "community-following";
  const ageHours = Math.max(0, (now - candidate.createdAt) / 3_600_000);
  const freshness = Math.exp(-ageHours / (communitySurface ? 40 : 32));
  const engagement =
    Math.log1p(Math.max(0, candidate.likeCount)) * 0.42 +
    Math.log1p(Math.max(0, candidate.repostCount)) * 0.72 +
    Math.log1p(Math.max(0, candidate.distinctCommenters)) * 1.05;
  const followWeight = communitySurface ? surface === "community-following" ? 2.1 : 0.45
    : surface === "following" ? 2.1 : 1.25;
  const interaction = Number(candidate.likedByMe) * 0.4 + Number(candidate.repostedByMe) * 0.55;
  const watch = Math.max(0, Math.min(1, candidate.watchProgress)) * 1.8;
  const interest = Math.min(4, Math.max(0, candidate.interestMatches)) * (communitySurface ? 1.35 : 0.9);
  const repeatPenalty = candidate.qualifiedViewRecently ? 1.6 : 0;
  return freshness * 1.5 + engagement + Number(candidate.followedAuthor) * followWeight +
    interaction + watch + interest - repeatPenalty;
}

/** Rank one fetched batch, then apply a light creator/topic diversity penalty. */
export function rankFeedCandidates<T extends FeedRankingCandidate>(
  candidates: readonly T[],
  surface: FeedSurface,
  now = Date.now(),
): T[] {
  const remaining = candidates.map(candidate => ({
    candidate,
    score: baseScore(candidate, surface, now),
    topics: [...new Set(
      (candidate.text.match(/#[\p{L}\p{N}_]+/gu) || []).map(topic => topic.toLowerCase()),
    )].slice(0, 4),
  }));
  const ranked: T[] = [];
  const creatorCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();

  while (remaining.length) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let index = 0; index < remaining.length; index++) {
      const item = remaining[index];
      const creatorRepeats = creatorCounts.get(item.candidate.authorId) || 0;
      if (creatorRepeats >= 3 && remaining.some(other =>
        (creatorCounts.get(other.candidate.authorId) || 0) < 3)) continue;
      const topicRepeats = item.topics.reduce((sum, topic) => sum + (topicCounts.get(topic) || 0), 0);
      const diversityScore = item.score - creatorRepeats * 0.9 - topicRepeats * 0.22;
      const tieBreak = item.candidate.createdAt / 1e16;
      const score = diversityScore + tieBreak;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) break;
    const [selected] = remaining.splice(bestIndex, 1);
    ranked.push(selected.candidate);
    creatorCounts.set(selected.candidate.authorId, (creatorCounts.get(selected.candidate.authorId) || 0) + 1);
    for (const topic of selected.topics) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  }
  return ranked;
}
