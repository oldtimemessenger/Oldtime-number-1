import { test } from "node:test";
import assert from "node:assert/strict";
import { installChatTransport, submitChatMessage, typingNames, acknowledgedStatus } from "./chat-transport.js";
test("without a connected server, messages remain queued rather than pretending to be sent", async () => {
  installChatTransport(null);
  assert.equal(await submitChatMessage("room", { id: "message" }), "queued");
});
test("only an actual adapter acknowledgement marks a message sent", async () => {
  installChatTransport({ send: async () => ({ accepted: true }) });
  assert.equal(await submitChatMessage("room", { id: "message" }), "sent");
  installChatTransport({ send: async () => undefined });
  await assert.rejects(submitChatMessage("room", { id: "message" }), /not acknowledged/);
  installChatTransport(null);
});
test("typing labels exclude self, expired signals, strangers and unknown profiles", () => {
  const peers = [{ userId: "friend", typing: true, expiresAt: 200 }, { userId: "me", typing: true, expiresAt: 200 }, { userId: "stranger", typing: true, expiresAt: 200 }, { userId: "friend", typing: true, expiresAt: 99 }];
  assert.deepEqual(typingNames(peers, { members: ["me", "friend"] }, "me", id => id === "friend" ? { name: "Jean" } : null, 100), ["Jean"]);
});
test("a late send acknowledgement does not erase an earlier delivery or read receipt", () => {
  assert.equal(acknowledgedStatus("read", "sent"), "read");
  assert.equal(acknowledgedStatus("delivered", "sent"), "delivered");
  assert.equal(acknowledgedStatus("sending", "sent"), "sent");
});
