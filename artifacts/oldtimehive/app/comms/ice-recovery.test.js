import assert from "node:assert/strict";
import test from "node:test";
import { createIceRestartAnswer, createIceRestartOffer } from "./ice-recovery.js";

test("ICE restart offer explicitly requests fresh candidates", async () => {
  const events = [];
  const pc = {
    localDescription: null,
    async createOffer(options) {
      events.push(["createOffer", options]);
      return { type: "offer", sdp: "restart-offer" };
    },
    async setLocalDescription(description) {
      events.push(["setLocalDescription", description]);
      this.localDescription = description;
    },
  };

  const offer = await createIceRestartOffer(pc);
  assert.deepEqual(events, [
    ["createOffer", { iceRestart: true }],
    ["setLocalDescription", { type: "offer", sdp: "restart-offer" }],
  ]);
  assert.deepEqual(offer, { type: "offer", sdp: "restart-offer" });
});

test("ICE restart answer applies the new offer before creating its answer", async () => {
  const events = [];
  const pc = {
    localDescription: null,
    async setRemoteDescription(description) {
      events.push(["setRemoteDescription", description]);
    },
    async createAnswer() {
      events.push(["createAnswer"]);
      return { type: "answer", sdp: "restart-answer" };
    },
    async setLocalDescription(description) {
      events.push(["setLocalDescription", description]);
      this.localDescription = description;
    },
  };

  const offer = { type: "offer", sdp: "restart-offer" };
  const answer = await createIceRestartAnswer(pc, offer);
  assert.deepEqual(events, [
    ["setRemoteDescription", offer],
    ["createAnswer"],
    ["setLocalDescription", { type: "answer", sdp: "restart-answer" }],
  ]);
  assert.deepEqual(answer, { type: "answer", sdp: "restart-answer" });
});
