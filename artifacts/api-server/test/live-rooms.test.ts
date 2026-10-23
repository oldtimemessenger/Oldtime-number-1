import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_MAX_COMMENT_LENGTH,
  LIVE_MAX_STAGE_MEMBERS,
  LIVE_MAX_VIEWERS,
  LiveRoomError,
  LiveRoomRegistry,
  type LiveIdentity,
} from "../src/lib/live-rooms";

const identity = (id: string): LiveIdentity => ({
  id,
  name: `Runner ${id}`,
  username: `runner${id}`,
  avatarUrl: null,
});

function makeRegistry() {
  let id = 0;
  let time = 1000;
  const registry = new LiveRoomRegistry(() => `id-${++id}`, () => ++time);
  return { registry, nextId: () => id };
}

test("room creation and discovery return real room state with no stored media", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Morning run", "socket-host");

  assert.equal(room.title, "Morning run");
  assert.equal(room.host.id, "host");
  assert.equal(room.viewerCount, 0);
  assert.equal(room.stageCount, 1);
  assert.equal(registry.list().length, 1);
  assert.deepEqual(room.comments, []);
});

test("rejects invalid titles and prevents a user from joining multiple rooms", () => {
  const { registry } = makeRegistry();
  assert.throws(() => registry.create(identity("host"), " ", "host-socket"), LiveRoomError);
  const room = registry.create(identity("host"), "Live run", "host-socket");
  assert.throws(
    () => registry.join(room.id, identity("host"), "second-device"),
    (error: unknown) => error instanceof LiveRoomError && error.code === "already-in-room",
  );
});

test("viewer count updates and room capacity is enforced", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Live run", "host-socket");
  for (let index = 1; index <= LIVE_MAX_VIEWERS; index += 1) {
    registry.join(room.id, identity(`viewer-${index}`), `socket-${index}`);
  }
  assert.equal(registry.getRoom(room.id).viewerCount, LIVE_MAX_VIEWERS);
  assert.throws(
    () => registry.join(room.id, identity("extra"), "extra-socket"),
    (error: unknown) => error instanceof LiveRoomError && error.code === "room-full",
  );
});

test("host approval reserves stage capacity, and only up to six can go on stage", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Live run", "host-socket");
  const guests = Array.from({ length: LIVE_MAX_STAGE_MEMBERS }, (_, index) => identity(`guest-${index}`));
  const requestIds: string[] = [];

  guests.forEach((guest, index) => {
    registry.join(room.id, guest, `guest-socket-${index}`);
  });
  registry.join(room.id, identity("extra"), "extra-socket");
  guests.forEach((guest) => requestIds.push(registry.requestStage(room.id, guest.id).id));
  const extraRequest = registry.requestStage(room.id, "extra");

  guests.slice(0, LIVE_MAX_STAGE_MEMBERS - 1).forEach((guest, index) => {
    registry.decideStageRequest(room.id, "host", requestIds[index]!, true);
    registry.markStageReady(room.id, guest.id);
  });

  assert.equal(registry.getRoom(room.id).stageCount, LIVE_MAX_STAGE_MEMBERS);
  assert.throws(
    () => registry.decideStageRequest(room.id, "host", extraRequest.id, true),
    (error: unknown) => error instanceof LiveRoomError && error.code === "stage-full",
  );
  assert.throws(
    () => registry.decideStageRequest(room.id, "guest-0", extraRequest.id, false),
    (error: unknown) => error instanceof LiveRoomError && error.code === "forbidden",
  );
});

test("host can remove a guest from stage without removing them from the room", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Live run", "host-socket");
  registry.join(room.id, identity("guest"), "guest-socket");
  const request = registry.requestStage(room.id, "guest");
  registry.decideStageRequest(room.id, "host", request.id, true);
  registry.markStageReady(room.id, "guest");

  const guest = registry.removeFromStage(room.id, "host", "guest");
  assert.equal(guest.role, "viewer");
  assert.equal(registry.getRoom(room.id).viewerCount, 1);
  assert.equal(registry.getRoom(room.id).stageCount, 1);
});

test("comments are trimmed, bounded, and retained only as a small in-memory window", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Live run", "host-socket");
  assert.throws(
    () => registry.addComment(room.id, identity("host"), "x".repeat(LIVE_MAX_COMMENT_LENGTH + 1)),
    (error: unknown) => error instanceof LiveRoomError && error.code === "invalid",
  );
  const comment = registry.addComment(room.id, identity("host"), "  Nice pace  ");
  assert.equal(comment.body, "Nice pace");
  assert.equal(registry.getRoom(room.id).comments.length, 1);
});

test("host leaving ends the room and clears participant indexes", () => {
  const { registry } = makeRegistry();
  const room = registry.create(identity("host"), "Live run", "host-socket");
  registry.join(room.id, identity("viewer"), "viewer-socket");
  const result = registry.leave(room.id, "host");

  assert.equal(result.ended, true);
  assert.equal(result.removed.length, 2);
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.getRoomIdForUser("viewer"), null);
});
