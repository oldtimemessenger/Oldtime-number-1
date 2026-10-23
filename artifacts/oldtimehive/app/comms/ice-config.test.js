import assert from "node:assert/strict";
import test from "node:test";
import { iceServers, STUN_URLS } from "./config.js";
import { selectedIceTransport } from "./transport.js";

function withTurnConfig(turn, run) {
  const previousWindow = globalThis.window;
  globalThis.window = { OLD_TIME_TURN: turn };
  try { run(); }
  finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test("Live rooms stay direct-only, even when TURN credentials exist", () => {
  withTurnConfig({
    urls: "turn:relay.example.test",
    username: "username",
    credential: "credential",
    expiresAt: Date.now() + 60_000,
    allowAutomaticRelay: true,
  }, () => {
    const config = iceServers({ allowTurnFallback: false });
    assert.deepEqual(config.iceServers, [{ urls: [...STUN_URLS] }]);
    assert.equal(config.iceTransportPolicy, "all");
    assert.equal(config.iceServers.some(server => String(server.urls).includes("turn:")), false);
  });
});

test("1:1 calls add TURN only with enabled, unexpired credentials", () => {
  const validTurn = {
    urls: ["turn:relay.example.test", "turns:relay.example.test"],
    username: "username",
    credential: "credential",
    expiresAt: Date.now() + 60_000,
    allowAutomaticRelay: true,
  };
  withTurnConfig(validTurn, () => {
    const config = iceServers({ allowTurnFallback: true });
    assert.deepEqual(config.iceServers[0], { urls: [...STUN_URLS] });
    assert.deepEqual(config.iceServers[1], {
      urls: validTurn.urls,
      username: validTurn.username,
      credential: validTurn.credential,
    });
    assert.equal(config.iceTransportPolicy, "all");
  });
  withTurnConfig({ ...validTurn, allowAutomaticRelay: false }, () => {
    assert.equal(iceServers({ allowTurnFallback: true }).iceServers.length, 1);
  });
  withTurnConfig({ ...validTurn, expiresAt: Date.now() - 1 }, () => {
    assert.equal(iceServers({ allowTurnFallback: true }).iceServers.length, 1);
  });
  withTurnConfig(validTurn, () => {
    assert.equal(iceServers({ allowTurnFallback: false }).iceServers.length, 1);
  });
});

test("1:1 calls remain STUN-only when no TURN provider is configured", () => {
  withTurnConfig(undefined, () => {
    const config = iceServers({ allowTurnFallback: true });
    assert.deepEqual(config.iceServers, [{ urls: [...STUN_URLS] }]);
  });
});

test("selected WebRTC path distinguishes direct from TURN relay candidates", () => {
  const direct = new Map([
    ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { id: "pair", type: "candidate-pair", state: "succeeded", localCandidateId: "local", remoteCandidateId: "remote" }],
    ["local", { id: "local", type: "local-candidate", candidateType: "host" }],
    ["remote", { id: "remote", type: "remote-candidate", candidateType: "srflx" }],
  ]);
  assert.equal(selectedIceTransport(direct), "direct");

  const relay = new Map([
    ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { id: "pair", type: "candidate-pair", state: "succeeded", localCandidateId: "local", remoteCandidateId: "remote" }],
    ["local", { id: "local", type: "local-candidate", candidateType: "relay" }],
    ["remote", { id: "remote", type: "remote-candidate", candidateType: "srflx" }],
  ]);
  assert.equal(selectedIceTransport(relay), "relay");
  assert.equal(selectedIceTransport(new Map()), "unknown");
});
