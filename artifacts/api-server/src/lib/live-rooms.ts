import { randomUUID } from "node:crypto";

export const LIVE_MAX_STAGE_MEMBERS = 6;
export const LIVE_MAX_VIEWERS = 12;
export const LIVE_MAX_COMMENT_LENGTH = 240;
export const LIVE_COMMENT_HISTORY_LIMIT = 60;

export interface LiveIdentity {
  id: string;
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface LiveParticipant extends LiveIdentity {
  role: "host" | "guest" | "viewer" | "invited";
  muted: boolean;
  cameraOn: boolean;
  joinedAt: number;
}

export interface LiveComment {
  id: string;
  userId: string;
  name: string;
  username: string;
  body: string;
  createdAt: number;
}

export interface LiveStageRequest {
  id: string;
  userId: string;
  name: string;
  username: string;
  createdAt: number;
}

export interface LiveRoomSummary {
  id: string;
  title: string;
  host: LiveIdentity;
  startedAt: number;
  viewerCount: number;
  stageCount: number;
  stage: LiveParticipant[];
}

export interface LiveRoomSnapshot extends LiveRoomSummary {
  participants: LiveParticipant[];
  comments: LiveComment[];
  requests: LiveStageRequest[];
}

interface LiveRoom {
  id: string;
  title: string;
  host: LiveIdentity;
  startedAt: number;
  participants: Map<string, LiveParticipant>;
  sockets: Map<string, string>;
  comments: LiveComment[];
  requests: Map<string, LiveStageRequest>;
}

export class LiveRoomError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid"
      | "not-found"
      | "forbidden"
      | "already-in-room"
      | "room-full"
      | "stage-full"
      | "request-not-found",
  ) {
    super(message);
    this.name = "LiveRoomError";
  }
}

/**
 * In-memory room state is deliberately ephemeral: no video or chat is saved.
 * This registry is intended for a single API-server process; a multi-instance
 * launch needs shared presence (for example Redis) and an SFU.
 */
export class LiveRoomRegistry {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly roomByUser = new Map<string, string>();

  constructor(
    private readonly makeId: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  create(identity: LiveIdentity, titleInput: unknown, socketId: string): LiveRoomSnapshot {
    const title = typeof titleInput === "string" ? titleInput.trim() : "";
    if (title.length < 2 || title.length > 80) {
      throw new LiveRoomError("Use a room title between 2 and 80 characters.", "invalid");
    }
    if (this.roomByUser.has(identity.id)) {
      throw new LiveRoomError("You are already in a live room.", "already-in-room");
    }

    const host: LiveParticipant = {
      ...identity,
      role: "host",
      muted: false,
      cameraOn: true,
      joinedAt: this.now(),
    };
    const room: LiveRoom = {
      id: this.makeId(),
      title,
      host: { ...identity },
      startedAt: this.now(),
      participants: new Map([[identity.id, host]]),
      sockets: new Map([[identity.id, socketId]]),
      comments: [],
      requests: new Map(),
    };
    this.rooms.set(room.id, room);
    this.roomByUser.set(identity.id, room.id);
    return this.snapshot(room);
  }

  join(roomId: string, identity: LiveIdentity, socketId: string): LiveRoomSnapshot {
    const room = this.requireRoom(roomId);
    if (this.roomByUser.has(identity.id)) {
      throw new LiveRoomError("You are already in a live room.", "already-in-room");
    }
    const viewers = [...room.participants.values()].filter((participant) => participant.role === "viewer").length;
    if (viewers >= LIVE_MAX_VIEWERS) {
      throw new LiveRoomError("This live is at capacity right now.", "room-full");
    }

    room.participants.set(identity.id, {
      ...identity,
      role: "viewer",
      muted: true,
      cameraOn: false,
      joinedAt: this.now(),
    });
    room.sockets.set(identity.id, socketId);
    this.roomByUser.set(identity.id, roomId);
    return this.snapshot(room);
  }

  leave(roomId: string, userId: string): { ended: boolean; removed: LiveParticipant[] } {
    const room = this.requireRoom(roomId);
    const participant = room.participants.get(userId);
    if (!participant) return { ended: false, removed: [] };
    if (participant.role === "host") {
      const removed = [...room.participants.values()];
      this.deleteRoom(room);
      return { ended: true, removed };
    }

    room.participants.delete(userId);
    room.sockets.delete(userId);
    this.roomByUser.delete(userId);
    for (const [requestId, request] of room.requests) {
      if (request.userId === userId) room.requests.delete(requestId);
    }
    return { ended: false, removed: [participant] };
  }

  end(roomId: string, hostId: string): LiveParticipant[] {
    const room = this.requireRoom(roomId);
    this.requireHost(room, hostId);
    const removed = [...room.participants.values()];
    this.deleteRoom(room);
    return removed;
  }

  requestStage(roomId: string, userId: string): LiveStageRequest {
    const room = this.requireRoom(roomId);
    const participant = this.requireParticipant(room, userId);
    if (participant.role !== "viewer") {
      throw new LiveRoomError("Only viewers can request to join the stage.", "forbidden");
    }
    if ([...room.requests.values()].some((request) => request.userId === userId)) {
      throw new LiveRoomError("Your stage request is already waiting for the host.", "invalid");
    }
    const reserved = [...room.participants.values()].filter((entry) => entry.role === "host" || entry.role === "guest" || entry.role === "invited").length;
    if (reserved >= LIVE_MAX_STAGE_MEMBERS) {
      throw new LiveRoomError("The stage is full right now.", "stage-full");
    }
    const request: LiveStageRequest = {
      id: this.makeId(),
      userId,
      name: participant.name,
      username: participant.username,
      createdAt: this.now(),
    };
    room.requests.set(request.id, request);
    return request;
  }

  decideStageRequest(roomId: string, hostId: string, requestId: string, accept: boolean): {
    request: LiveStageRequest;
    participant: LiveParticipant;
  } {
    const room = this.requireRoom(roomId);
    this.requireHost(room, hostId);
    const request = room.requests.get(requestId);
    if (!request) throw new LiveRoomError("That stage request is no longer available.", "request-not-found");
    const participant = this.requireParticipant(room, request.userId);
    room.requests.delete(requestId);

    if (accept) {
      const reserved = [...room.participants.values()].filter((entry) => entry.role === "host" || entry.role === "guest" || entry.role === "invited").length;
      if (reserved >= LIVE_MAX_STAGE_MEMBERS) {
        throw new LiveRoomError("The stage is full right now.", "stage-full");
      }
      participant.role = "invited";
    }
    return { request, participant: { ...participant } };
  }

  markStageReady(roomId: string, userId: string): LiveParticipant {
    const room = this.requireRoom(roomId);
    const participant = this.requireParticipant(room, userId);
    if (participant.role !== "invited") {
      throw new LiveRoomError("The host has not approved your stage request.", "forbidden");
    }
    participant.role = "guest";
    participant.muted = false;
    participant.cameraOn = true;
    return { ...participant };
  }

  cancelStageInvite(roomId: string, userId: string): LiveParticipant {
    const room = this.requireRoom(roomId);
    const participant = this.requireParticipant(room, userId);
    if (participant.role !== "invited") {
      throw new LiveRoomError("There is no pending stage invitation.", "forbidden");
    }
    participant.role = "viewer";
    participant.muted = true;
    participant.cameraOn = false;
    return { ...participant };
  }

  removeFromStage(roomId: string, hostId: string, userId: string): LiveParticipant {
    const room = this.requireRoom(roomId);
    this.requireHost(room, hostId);
    const participant = this.requireParticipant(room, userId);
    if (participant.role !== "guest" && participant.role !== "invited") {
      throw new LiveRoomError("That person is not on the stage.", "invalid");
    }
    participant.role = "viewer";
    participant.muted = true;
    participant.cameraOn = false;
    return { ...participant };
  }

  updateMediaState(roomId: string, userId: string, patch: { muted?: boolean; cameraOn?: boolean }): LiveParticipant {
    const room = this.requireRoom(roomId);
    const participant = this.requireParticipant(room, userId);
    if (participant.role !== "host" && participant.role !== "guest") {
      throw new LiveRoomError("Only stage members can change microphone or camera status.", "forbidden");
    }
    if (typeof patch.muted === "boolean") participant.muted = patch.muted;
    if (typeof patch.cameraOn === "boolean") participant.cameraOn = patch.cameraOn;
    return { ...participant };
  }

  addComment(roomId: string, identity: LiveIdentity, bodyInput: unknown): LiveComment {
    const room = this.requireRoom(roomId);
    this.requireParticipant(room, identity.id);
    const body = typeof bodyInput === "string" ? bodyInput.trim() : "";
    if (!body || body.length > LIVE_MAX_COMMENT_LENGTH) {
      throw new LiveRoomError(`Comments must be 1 to ${LIVE_MAX_COMMENT_LENGTH} characters.`, "invalid");
    }
    const comment: LiveComment = {
      id: this.makeId(),
      userId: identity.id,
      name: identity.name,
      username: identity.username,
      body,
      createdAt: this.now(),
    };
    room.comments.push(comment);
    if (room.comments.length > LIVE_COMMENT_HISTORY_LIMIT) {
      room.comments.splice(0, room.comments.length - LIVE_COMMENT_HISTORY_LIMIT);
    }
    return comment;
  }

  getRoomIdForUser(userId: string): string | null {
    return this.roomByUser.get(userId) ?? null;
  }

  getRoom(roomId: string): LiveRoomSnapshot {
    return this.snapshot(this.requireRoom(roomId));
  }

  getSocketId(roomId: string, userId: string): string | null {
    return this.requireRoom(roomId).sockets.get(userId) ?? null;
  }

  list(): LiveRoomSummary[] {
    return [...this.rooms.values()]
      .sort((left, right) => right.startedAt - left.startedAt)
      .map((room) => this.summary(room));
  }

  private requireRoom(roomId: string): LiveRoom {
    const room = this.rooms.get(roomId);
    if (!room) throw new LiveRoomError("This live room has ended.", "not-found");
    return room;
  }

  private requireParticipant(room: LiveRoom, userId: string): LiveParticipant {
    const participant = room.participants.get(userId);
    if (!participant) throw new LiveRoomError("Join this live room to continue.", "forbidden");
    return participant;
  }

  private requireHost(room: LiveRoom, userId: string): void {
    if (room.host.id !== userId) {
      throw new LiveRoomError("Only the host can manage this live room.", "forbidden");
    }
  }

  private deleteRoom(room: LiveRoom): void {
    this.rooms.delete(room.id);
    for (const userId of room.participants.keys()) this.roomByUser.delete(userId);
  }

  private summary(room: LiveRoom): LiveRoomSummary {
    const participants = [...room.participants.values()];
    return {
      id: room.id,
      title: room.title,
      host: room.host,
      startedAt: room.startedAt,
      viewerCount: participants.filter((participant) => participant.role === "viewer").length,
      stageCount: participants.filter((participant) => participant.role === "host" || participant.role === "guest").length,
      stage: participants.filter((participant) => participant.role === "host" || participant.role === "guest"),
    };
  }

  private snapshot(room: LiveRoom): LiveRoomSnapshot {
    return {
      ...this.summary(room),
      participants: [...room.participants.values()],
      comments: [...room.comments],
      requests: [...room.requests.values()],
    };
  }
}
