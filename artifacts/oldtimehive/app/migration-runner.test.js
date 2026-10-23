import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationRunner } from "./migration-runner.js";

function harness(run) {
  let owner = "owner-a";
  const tasks = [];
  const runner = createMigrationRunner({
    currentOwner: () => owner, run,
    schedule: (task, delay) => { const entry = { task, delay }; tasks.push(entry); return entry; },
    cancel: entry => { const index = tasks.indexOf(entry); if (index >= 0) tasks.splice(index, 1); },
    onError() {},
  });
  return { runner, tasks, owner: value => { owner = value; }, tick: async () => { await tasks.shift()?.task(); } };
}
test("recovery retries partial warnings and stops after server-confirmed success", async () => {
  let calls = 0;
  const h = harness(async () => [{ warning: ++calls === 1 }]);
  h.runner.request("owner-a");
  h.runner.request("owner-a");
  assert.equal(h.tasks.length, 1);
  await h.tick();
  assert.equal(h.tasks[0].delay, 15_000);
  await h.tick();
  await h.tick();
  assert.equal(calls, 2);
  assert.equal(h.tasks.length, 0);
  h.runner.request("owner-a");
  assert.equal(h.tasks.length, 0);
});
test("recovery stops on account changes without running as a different owner", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return []; });
  h.runner.request("owner-a");
  h.owner("owner-b");
  await h.tick();
  assert.equal(calls, 0);
  h.runner.request("owner-b");
  await h.tick();
  assert.equal(calls, 1);
});
test("network failures use bounded retries and can restart on reconnection", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new Error("offline"); });
  h.runner.request("owner-a");
  while (h.tasks.length) await h.tick();
  assert.equal(calls, 4);
  h.runner.request("owner-a");
  assert.equal(h.tasks.length, 0);
  h.runner.request("owner-a", { retry: true });
  assert.equal(h.tasks.length, 1);
  h.runner.reset();
  assert.equal(h.tasks.length, 0);
});
