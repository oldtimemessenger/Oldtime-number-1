import test from "node:test";
import assert from "node:assert/strict";
import { parseBoardLink, boardLink, forYouPlan, rankBoards, isUuid } from "./get-on-board-core.js";
const B = "3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b", E = "4f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b";
test("parses links", () => {
  assert.deepEqual(parseBoardLink(`https://x.test/?board=${B}&entry=${E}`), { boardId: B, entryId: E });
  assert.deepEqual(parseBoardLink(`?board=${B}`), { boardId: B, entryId: undefined });
  assert.equal(parseBoardLink("?board=nope"), null);
  assert.equal(parseBoardLink(boardLink(B, E, "https://x.test")).entryId, E);
});
test("for you needs consent", () => {
  assert.equal(forYouPlan({ enabled: false, selected: ["Sports"] }).category, "");
  assert.equal(forYouPlan({ enabled: true, selected: [] }).category, "");
  assert.equal(forYouPlan({ enabled: true, selected: ["Music", "Sports"] }).category, "music");
  assert.deepEqual(rankBoards([{ category: "funny" }, { category: "sports" }], ["sports"]).map(b => b.category), ["sports", "funny"]);
  assert.ok(isUuid(B));
});
import { boardIdFrom, entriesUrl } from "./get-on-board-core.js";
test("new board entry url never undefined", () => {
  const stack = [{ s: "home" }, { s: "board", id: B }, { s: "compose", id: B }];
  assert.equal(entriesUrl(boardIdFrom(stack, { id: B })), `/api/boards/${B}/entries`);
  assert.equal(boardIdFrom([{ s: "home" }, { s: "compose" }], { id: B }), B);
  assert.throws(() => entriesUrl(boardIdFrom([{ s: "compose" }], null)));
  assert.match(entriesUrl(B, E, "a b"), /\?id=.*&caption=a%20b$/);
});
