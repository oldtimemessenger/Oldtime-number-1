import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./blast-cloud-state.js", import.meta.url), "utf8");
const blankState = () => ({ version: 1, friendships: [], friendRequests: [], posts: [], preferences: {}, communityMemberships: [] });
async function fixture(t, current, legacy, { failVerification = false } = {}) {
  const originalWindow = globalThis.window, originalStorage = globalThis.localStorage;
  globalThis.window = { dispatchEvent() {}, addEventListener() {} };
  globalThis.localStorage = { getItem: () => JSON.stringify(legacy) };
  t.after(() => { globalThis.window = originalWindow; globalThis.localStorage = originalStorage; });
  let remote = current, revision = 4, writes = 0, cleaned = 0, prepared = 0;
  const jsonbOrder = value => Array.isArray(value) ? value.map(jsonbOrder) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().reverse().map(key => [key, jsonbOrder(value[key])])) : value;
  const request = async (_path, options) => {
    if (options?.method === "PUT") {
      assert.equal(options.body.revision, revision);
      remote = structuredClone(options.body.data); revision++; writes++;
      return { data: structuredClone(remote), revision };
    }
    return { data: failVerification && writes ? blankState() : jsonbOrder(remote), revision };
  };
  globalThis.__blastMigrationStub = { api: { cloudAccountId: () => "owner", me: () => ({ id: "owner" }) }, requestCloudApi: request };
  t.after(() => { delete globalThis.__blastMigrationStub; });
  const module = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
    'import { api, requestCloudApi } from "./store.js";',
    "const { api, requestCloudApi } = globalThis.__blastMigrationStub;",
  ) + `\n// fixture ${Math.random()}`).toString("base64")}`);
  const load = scope => module.loadBlastCloudState(scope, {
    blankState, legacyKey: "legacy", filterLegacy: value => value,
    prepareLegacy: async value => { prepared++; return { data: value }; },
    removeMigratedLegacy: async () => { cleaned++; },
  });
  return { load, remote: () => remote, stats: () => ({ writes, cleaned, prepared }) };
}
test("older Blast content joins existing cloud data without replacing newer edits or collapsing memberships", async t => {
  const old = { ...blankState(), posts: [{ id: "same", body: "old" }, { id: "older", body: "recover" }],
    communityMemberships: [{ userId: "owner", communityId: "one" }, { userId: "owner", communityId: "two" }] };
  const current = { ...blankState(), posts: [{ id: "same", body: "new" }, { id: "cloud", body: "keep" }] };
  const f = await fixture(t, current, old);
  const result = await f.load("social");
  assert.deepEqual(result.posts.map(post => post.id).sort(), ["cloud", "older", "same"]);
  assert.equal(result.posts.find(post => post.id === "same").body, "new");
  assert.equal(result.communityMemberships.length, 2);
  assert.equal(Object.values(result.recoverySources)[0].posts[0].body, "old");
  assert.equal(f.stats().cleaned, 1);
  // A previously-confirmed recovery does not upload the same media again.
  await f.load("social");
  assert.equal(f.stats().prepared, 1);
});
test("a mismatched cloud read never deletes the original Blast source", async t => {
  const f = await fixture(t, blankState(), { ...blankState(), posts: [{ id: "old" }] }, { failVerification: true });
  await assert.rejects(f.load("social"), /did not match/);
  assert.equal(f.stats().cleaned, 0);
});
test("recovering a chat retains both older messages and newer cloud messages", async t => {
  const old = { version: 1, notes: [], saved: [], chats: [{ id: "chat", messages: [{ id: "old", text: "old" }] }] };
  const current = { version: 1, notes: [], saved: [], chats: [{ id: "chat", messages: [{ id: "new", text: "new" }] }] };
  const f = await fixture(t, current, old);
  const result = await f.load("video-notes");
  assert.deepEqual(result.chats[0].messages.map(message => message.id), ["old", "new"]);
});
