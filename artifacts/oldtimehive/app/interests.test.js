import test from "node:test";
import assert from "node:assert/strict";
import { readInterests, saveInterests, resetInterests, interestContext } from "./interests.js";
import { mockCloudAccountState } from "./test-cloud-state.js";
test("interests are per account, validated, resettable and disableable", async () => {
  const cloud = mockCloudAccountState("a");
  assert.equal(interestContext("a").interestsSet, false);
  assert.deepEqual(await saveInterests("a", { selected: ["Sports", "Sports", "Bogus"] }), ["Sports"]);
  assert.deepEqual(interestContext("a"), { interests: ["Sports"], interestsSet: true });
  cloud.switchAccount("b");
  assert.equal(interestContext("b").interestsSet, false);
  cloud.switchAccount("a");
  await saveInterests("a", { enabled: false, selected: ["Music"] });
  assert.deepEqual(interestContext("a").interests, []);
  await resetInterests("a");
  assert.equal(readInterests("a").decided, false);
  cloud.restore();
});
test("unavailable account state never prompts", () => {
  const cloud = mockCloudAccountState("a");
  cloud.setLoaded(false);
  assert.equal(interestContext("a").interestsSet, true);
  cloud.restore();
});
