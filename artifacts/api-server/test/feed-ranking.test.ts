import assert from "node:assert/strict";
import test from "node:test";
import { rankFeedCandidates, type FeedRankingCandidate } from "../src/lib/feed-ranking";

function candidate(id: string, overrides: Partial<FeedRankingCandidate> = {}): FeedRankingCandidate {
  return {
    id,
    authorId: id,
    createdAt: 1_000,
    text: "",
    likeCount: 0,
    repostCount: 0,
    distinctCommenters: 0,
    followedAuthor: false,
    likedByMe: false,
    repostedByMe: false,
    watchProgress: 0,
    qualifiedViewRecently: false,
    interestMatches: 0,
    ...overrides,
  };
}

test("main and community ranking use separate follow and interest weights", () => {
  const followed = candidate("followed", { followedAuthor: true });
  const relevant = candidate("relevant", { interestMatches: 1 });
  assert.equal(rankFeedCandidates([relevant, followed], "main", 1_000)[0], followed);
  assert.equal(rankFeedCandidates([relevant, followed], "community", 1_000)[0], relevant);
});

test("meaningful discussion and watch completion rank above raw low-quality likes", () => {
  const discussed = candidate("discussed", { distinctCommenters: 8, watchProgress: 0.9 });
  const liked = candidate("liked", { likeCount: 100 });
  assert.equal(rankFeedCandidates([liked, discussed], "main", 1_000)[0], discussed);
});

test("recently qualified views are downranked without hiding the post", () => {
  const fresh = candidate("fresh", { createdAt: 1000 });
  const seen = candidate("seen", { createdAt: 1000, qualifiedViewRecently: true });
  const result = rankFeedCandidates([seen, fresh], "main", 1000);
  assert.equal(result[0], fresh);
  assert.equal(result.length, 2);
});

test("batch ranking limits repeated creators and spreads matching hashtags", () => {
  const repeated = ["a1", "a2", "a3", "a4"].map(id =>
    candidate(id, { authorId: "same-author", likeCount: 100, text: "#life" }));
  const diverse = candidate("b1", { authorId: "other-author", likeCount: 20, text: "#travel" });
  const result = rankFeedCandidates([...repeated, diverse], "main", 1000);
  assert.equal(result[0], repeated[0]);
  assert.ok(result.indexOf(diverse) < 3);
});
