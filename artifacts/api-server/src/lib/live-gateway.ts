import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { accountBlocksTable, chatMembersTable, db, usersTable } from "@workspace/db";
import { logger } from "./logger";
import { authenticateAccessToken, type AuthContext } from "./auth";
import {
  LiveRoomError,
  LiveRoomRegistry,
  type LiveComment,
  type LiveIdentity,
  type LiveParticipant,
  type LiveRoomSnapshot,
  type LiveRoomSummary,
  type LiveStageRequest,
} from "./live-rooms";

type Ack<T = undefined> = (result: { ok: true; data: T } | { ok: false; error: string }) => void;
type SignalPayload =
  | { kind: "description"; description: { type: "offer" | "answer"; sdp: string } }
  | { kind: "candidate"; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

interface ClientToServerEvents {
  "call:signal:send": (input: CallSignalInput, ack: Ack) => void;
  "call:transport:report": (input: CallTransportReportInput, ack: Ack) => void;
  "live:rooms:list": (ack: Ack<LiveRoomSummary[]>) => void;
  "live:room:create": (input: { title: string }, ack: Ack<LiveRoomSnapshot>) => void;
  "live:room:join": (input: { roomId: string }, ack: Ack<LiveRoomSnapshot>) => void;
  "live:room:leave": (input: { roomId: string }, ack: Ack) => void;
  "live:room:end": (input: { roomId: string }, ack: Ack) => void;
  "live:comment:send": (input: { roomId: string; body: string }, ack: Ack<LiveComment>) => void;
  "live:heart:send": (input: { roomId: string }, ack: Ack) => void;
  "live:stage:request": (input: { roomId: string }, ack: Ack<LiveStageRequest>) => void;
  "live:stage:decision": (input: { roomId: string; requestId: string; accept: boolean }, ack: Ack<LiveParticipant>) => void;
  "live:stage:ready": (input: { roomId: string }, ack: Ack<LiveParticipant>) => void;
  "live:stage:decline": (input: { roomId: string }, ack: Ack<LiveParticipant>) => void;
  "live:stage:remove": (input: { roomId: string; userId: string }, ack: Ack<LiveParticipant>) => void;
  "live:media:update": (input: { roomId: string; muted?: boolean; cameraOn?: boolean }, ack: Ack<LiveParticipant>) => void;
  "live:signal:send": (input: { roomId: string; toUserId: string; signal: SignalPayload }, ack: Ack) => void;
}

interface ServerToClientEvents {
  "call:signal:receive": (signal: CallSignalEvent) => void;
  "chat:changed": (update: { conversationId: string }) => void;
  "notifications:changed": () => void;
  "live:rooms:update": (rooms: LiveRoomSummary[]) => void;
  "live:room:snapshot": (snapshot: LiveRoomSnapshot) => void;
  "live:room:participant-joined": (participant: LiveParticipant) => void;
  "live:room:participant-left": (data: { userId: string }) => void;
  "live:room:ended": (data: { roomId: string; message: string }) => void;
  "live:comment": (comment: LiveComment) => void;
  "live:heart": (data: { userId: string; name: string; createdAt: number }) => void;
  "live:stage:request": (request: LiveStageRequest) => void;
  "live:stage:decision": (data: { requestId: string; accepted: boolean; participant: LiveParticipant }) => void;
  "live:stage:ready": (participant: LiveParticipant) => void;
  "live:stage:declined": (participant: LiveParticipant) => void;
  "live:stage:removed": (participant: LiveParticipant) => void;
  "live:media:state": (participant: LiveParticipant) => void;
  "live:signal:receive": (data: { roomId: string; fromUserId: string; signal: SignalPayload }) => void;
  "live:error": (data: { message: string }) => void;
}

interface InterServerEvents {}

interface SocketData {
  auth: AuthContext;
  identity: LiveIdentity;
  roomId: string | null;
}

type LiveSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
type LiveIo = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

type CallSignalType = "invite" | "answer" | "ice" | "ice-restart-request" | "accept" | "ringing" | "reject" | "end";
interface CallSignalInput {
  callId: string;
  toUserId: string;
  type: CallSignalType;
  payload: unknown;
}
interface CallSignalEvent {
  callId: string;
  from: string;
  to: string;
  type: CallSignalType;
  payload: unknown;
  at: number;
  sender: { id: string; username: string; displayName: string };
}
interface CallTransportReportInput {
  callId: string;
  stage: "ended" | "failed";
  transport: "direct" | "relay" | "unknown";
  video: boolean;
  durationSeconds: number;
  networkType: "slow-2g" | "2g" | "3g" | "4g" | "unknown";
  failure?: "ice-failed";
}
interface CallSession {
  conversationId: string;
  callerId: string;
  calleeId: string;
  expiresAt: number;
}

const RoomIdSchema = z.string().min(1).max(128);
const CreateRoomSchema = z.object({ title: z.string().trim().min(2).max(80) }).strict();
const JoinRoomSchema = z.object({ roomId: RoomIdSchema }).strict();
const CommentSchema = z.object({ roomId: RoomIdSchema, body: z.string().trim().min(1).max(240) }).strict();
const StageDecisionSchema = z.object({
  roomId: RoomIdSchema,
  requestId: z.string().min(1).max(128),
  accept: z.boolean(),
}).strict();
const RemoveGuestSchema = z.object({ roomId: RoomIdSchema, userId: z.string().uuid() }).strict();
const MediaUpdateSchema = z.object({
  roomId: RoomIdSchema,
  muted: z.boolean().optional(),
  cameraOn: z.boolean().optional(),
}).strict().refine((value) => value.muted !== undefined || value.cameraOn !== undefined);
const SignalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("description"),
    description: z.object({
      type: z.enum(["offer", "answer"]),
      sdp: z.string().min(1).max(30_000),
    }).strict(),
  }).strict(),
  z.object({
    kind: z.literal("candidate"),
    candidate: z.object({
      candidate: z.string().max(4_096),
      sdpMid: z.string().max(128).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(256).nullable().optional(),
    }).strict(),
  }).strict(),
]);
const SendSignalSchema = z.object({
  roomId: RoomIdSchema,
  toUserId: z.string().uuid(),
  signal: SignalSchema,
}).strict();
const RtcDescriptionSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(30_000),
}).strict();
const RtcCandidateSchema = z.object({
  candidate: z.string().max(4_096),
  sdpMid: z.string().max(128).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(256).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();
const EmptyPayloadSchema = z.object({}).strict();
const CallPayloadSchemas = {
  invite: z.object({
    convoId: z.string().min(1).max(128),
    video: z.boolean(),
    offer: RtcDescriptionSchema,
    retry: z.boolean().optional(),
  }).strict(),
  answer: z.object({ answer: RtcDescriptionSchema }).strict(),
  ice: z.object({ candidate: RtcCandidateSchema }).strict(),
  "ice-restart-request": EmptyPayloadSchema,
  accept: EmptyPayloadSchema,
  ringing: EmptyPayloadSchema,
  reject: z.object({ reason: z.enum(["failed", "declined", "busy", "timeout"]).optional() }).strict(),
  end: z.object({ reason: z.string().max(40).optional() }).strict(),
} satisfies Record<CallSignalType, z.ZodType>;
const CallSignalInputSchema = z.object({
  callId: z.string().min(1).max(128),
  toUserId: z.string().uuid(),
  type: z.enum(["invite", "answer", "ice", "ice-restart-request", "accept", "ringing", "reject", "end"]),
  payload: z.unknown(),
}).strict();
const CallTransportReportSchema = z.object({
  callId: z.string().min(1).max(128),
  stage: z.enum(["ended", "failed"]),
  transport: z.enum(["direct", "relay", "unknown"]),
  video: z.boolean(),
  durationSeconds: z.number().int().min(0).max(86_400),
  networkType: z.enum(["slow-2g", "2g", "3g", "4g", "unknown"]),
  failure: z.enum(["ice-failed"]).optional(),
}).strict();

const registry = new LiveRoomRegistry();
const MAX_SIGNAL_RATE_MS = 40;
const MAX_CALL_TRANSPORT_REPORT_RATE_MS = 100;
const MAX_CHAT_RATE_MS = 900;
const MAX_HEART_RATE_MS = 120;
const lastEventAt = new Map<string, number>();
const callSessions = new Map<string, CallSession>();
const callSignalBursts = new Map<string, number[]>();
let activeGateway: LiveIo | null = null;

export function notifyAccountActivity(userId: string): void {
  activeGateway?.to(callUserRoomKey(userId)).emit("notifications:changed");
}

function allowCallSignal(socketId: string): boolean {
  const now = Date.now();
  const recent = (callSignalBursts.get(socketId) || []).filter(at => now - at < 10_000);
  if (recent.length >= 200) return false;
  recent.push(now);
  callSignalBursts.set(socketId, recent);
  return true;
}

function callsAreDisabled(): boolean {
  return true;
}

export async function notifyChatChanged(conversationId: string): Promise<void> {
  const io = activeGateway;
  if (!io) return;
  try {
    const members = await db.select({ userId: chatMembersTable.userId })
      .from(chatMembersTable).where(eq(chatMembersTable.conversationId, conversationId));
    for (const member of members) io.to(callUserRoomKey(member.userId)).emit("chat:changed", { conversationId });
  } catch {
    logger.warn({ conversationId }, "Chat update notification could not be sent");
  }
}

function eventError(error: unknown): string {
  if (error instanceof LiveRoomError) return error.message;
  return "Live is temporarily unavailable. Try again.";
}

function ackError<T>(ack: Ack<T>, error: unknown): void {
  ack({ ok: false, error: eventError(error) });
}

function roomEventKey(roomId: string): string {
  return `live:${roomId}`;
}

function callUserRoomKey(userId: string): string {
  return `call-user:${userId}`;
}

async function canStartDirectCall(conversationId: string, callerId: string, calleeId: string): Promise<boolean> {
  const members = await db.select({ userId: chatMembersTable.userId })
    .from(chatMembersTable)
    .where(eq(chatMembersTable.conversationId, conversationId));
  const memberIds = new Set(members.map((member) => member.userId));
  if (members.length !== 2 || !memberIds.has(callerId) || !memberIds.has(calleeId)) return false;

  const [blocked] = await db.select({ ownerId: accountBlocksTable.ownerId })
    .from(accountBlocksTable)
    .where(or(
      and(eq(accountBlocksTable.ownerId, callerId), eq(accountBlocksTable.blockedId, calleeId)),
      and(eq(accountBlocksTable.ownerId, calleeId), eq(accountBlocksTable.blockedId, callerId)),
    ))
    .limit(1);
  return !blocked;
}

function pruneCallSessions(now: number): void {
  for (const [callId, call] of callSessions) {
    if (call.expiresAt <= now) callSessions.delete(callId);
  }
}

function allowEvent(socketId: string, event: string, interval: number): boolean {
  const now = Date.now();
  const key = `${socketId}:${event}`;
  const previous = lastEventAt.get(key) ?? 0;
  if (now - previous < interval) return false;
  lastEventAt.set(key, now);
  if (lastEventAt.size > 20_000) {
    for (const [entryKey, at] of lastEventAt) {
      if (now - at > 60_000) lastEventAt.delete(entryKey);
    }
  }
  return true;
}

async function identityForUser(userId: string): Promise<LiveIdentity | null> {
  const [user] = await db
    .select({ id: usersTable.id, name: usersTable.displayName, username: usersTable.username })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!user) return null;
  return { id: user.id, name: user.name, username: user.username, avatarUrl: null };
}

function publishRooms(io: LiveIo): void {
  io.emit("live:rooms:update", registry.list());
}

function leaveRoom(socket: LiveSocket, io: LiveIo, roomId: string): void {
  const userId = socket.data.auth.userId;
  if (registry.getRoomIdForUser(userId) !== roomId) return;
  const result = registry.leave(roomId, userId);
  socket.leave(roomEventKey(roomId));
  socket.data.roomId = null;
  if (result.ended) {
    io.to(roomEventKey(roomId)).emit("live:room:ended", {
      roomId,
      message: "The host ended this live.",
    });
    io.in(roomEventKey(roomId)).socketsLeave(roomEventKey(roomId));
  } else {
    io.to(roomEventKey(roomId)).emit("live:room:participant-left", { userId });
    try {
      io.to(roomEventKey(roomId)).emit("live:room:snapshot", registry.getRoom(roomId));
    } catch {
      // A host may end the room between leave and snapshot delivery.
    }
  }
  publishRooms(io);
}

export function attachLiveGateway(server: HttpServer): LiveIo {
  const production = process.env.NODE_ENV === "production";
  const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? "").split(",").map(value => value.trim()).filter(Boolean),
  );
  const io: LiveIo = new Server(server, {
    path: "/api/live/socket.io",
    transports: ["websocket", "polling"],
    cors: {
      origin: (origin, callback) => callback(null, !origin || !production || allowedOrigins.has(origin)),
      credentials: false,
    },
    maxHttpBufferSize: 128 * 1024,
    connectTimeout: 10_000,
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });
  activeGateway = io;

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.accessToken as unknown;
      const auth = await authenticateAccessToken(token);
      if (!auth) {
        next(new Error("Sign in to join Oldtime Live."));
        return;
      }
      const identity = await identityForUser(auth.userId);
      if (!identity) {
        next(new Error("Your Oldtime account is not available."));
        return;
      }
      socket.data.auth = auth;
      socket.data.identity = identity;
      socket.data.roomId = null;
      next();
    } catch {
      next(new Error("Secure sign-in could not be verified. Try again."));
    }
  });

  io.on("connection", (socket) => {
    socket.join(callUserRoomKey(socket.data.auth.userId));
    socket.emit("live:rooms:update", registry.list());

    socket.on("call:signal:send", async (input, ack) => {
      const respond = (result: { ok: true; data: undefined } | { ok: false; error: string }) => {
        if (typeof ack === "function") ack(result);
      };
      if (callsAreDisabled()) {
        respond({ ok: false, error: "Voice and video calls are disabled in Oldtime." });
        return;
      }
      const parsed = CallSignalInputSchema.safeParse(input);
      if (!parsed.success) {
        respond({ ok: false, error: "The call message is invalid." });
        return;
      }
      if (!allowCallSignal(socket.id)) {
        respond({ ok: false, error: "Call signaling is arriving too quickly." });
        return;
      }
      const payloadResult = CallPayloadSchemas[parsed.data.type].safeParse(parsed.data.payload);
      if (!payloadResult.success) {
        respond({ ok: false, error: "The call message is invalid." });
        return;
      }

      const callerId = socket.data.auth.userId;
      const { callId, toUserId, type } = parsed.data;
      if (callerId === toUserId) {
        respond({ ok: false, error: "You cannot call your own account." });
        return;
      }
      const now = Date.now();
      pruneCallSessions(now);
      let call = callSessions.get(callId);

      if (type === "invite") {
        const payload = payloadResult.data as z.infer<typeof CallPayloadSchemas.invite>;
        if (call) {
          if (call.callerId !== callerId || call.calleeId !== toUserId || call.conversationId !== payload.convoId) {
            respond({ ok: false, error: "This call session is unavailable." });
            return;
          }
        } else {
          let allowed = false;
          try {
            allowed = await canStartDirectCall(payload.convoId, callerId, toUserId);
          } catch {
            respond({ ok: false, error: "Call access could not be verified. Try again." });
            return;
          }
          if (!allowed) {
            respond({ ok: false, error: "Calls are available only between members of an active 1:1 chat." });
            return;
          }
          call = {
            conversationId: payload.convoId,
            callerId,
            calleeId: toUserId,
            expiresAt: now + 3 * 60 * 60 * 1000,
          };
          callSessions.set(callId, call);
        }
      } else if (!call
        || !((call.callerId === callerId && call.calleeId === toUserId)
          || (call.calleeId === callerId && call.callerId === toUserId))) {
        respond({ ok: false, error: "This call session has expired." });
        return;
      }

      const signal: CallSignalEvent = {
        callId,
        from: callerId,
        to: toUserId,
        type,
        payload: payloadResult.data,
        at: now,
        sender: {
          id: callerId,
          username: socket.data.identity.username,
          displayName: socket.data.identity.name,
        },
      };
      io.to(callUserRoomKey(toUserId)).emit("call:signal:receive", signal);
      respond({ ok: true, data: undefined });
      if (type === "end" || type === "reject") callSessions.delete(callId);
      else if (call) call.expiresAt = now + 3 * 60 * 60 * 1000;
    });

    socket.on("call:transport:report", (input, ack) => {
      const respond = (result: { ok: true; data: undefined } | { ok: false; error: string }) => {
        if (typeof ack === "function") ack(result);
      };
      if (callsAreDisabled()) {
        respond({ ok: false, error: "Call reporting is disabled in Oldtime." });
        return;
      }
      const parsed = CallTransportReportSchema.safeParse(input);
      if (!parsed.success) {
        respond({ ok: false, error: "The call report is invalid." });
        return;
      }
      if (!allowEvent(socket.id, "call-transport-report", MAX_CALL_TRANSPORT_REPORT_RATE_MS)) {
        respond({ ok: false, error: "Call reports are arriving too quickly." });
        return;
      }
      const { callId, ...report } = parsed.data;
      const call = callSessions.get(callId);
      const userId = socket.data.auth.userId;
      if (!call || (call.callerId !== userId && call.calleeId !== userId)) {
        respond({ ok: false, error: "This call session has expired." });
        return;
      }
      const context = {
        callId,
        reporter: call.callerId === userId ? "caller" : "callee",
        ...report,
      };
      if (report.stage === "failed") {
        logger.warn(context, "Call connectivity failed");
      } else {
        logger.info(context, "Call transport usage");
      }
      respond({ ok: true, data: undefined });
    });

    socket.on("live:rooms:list", (ack) => {
      // Some older clients send this as a fire-and-forget event. Never let a
      // missing Socket.IO acknowledgement handler take down the API process.
      if (typeof ack === "function") ack({ ok: true, data: registry.list() });
    });

    socket.on("live:room:create", (input, ack) => {
      const parsed = CreateRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Use a room title between 2 and 80 characters." });
        return;
      }
      try {
        const snapshot = registry.create(socket.data.identity, parsed.data.title, socket.id);
        socket.join(roomEventKey(snapshot.id));
        socket.data.roomId = snapshot.id;
        publishRooms(io);
        ack({ ok: true, data: snapshot });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:room:join", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      try {
        const snapshot = registry.join(parsed.data.roomId, socket.data.identity, socket.id);
        socket.join(roomEventKey(parsed.data.roomId));
        socket.data.roomId = parsed.data.roomId;
        socket.to(roomEventKey(parsed.data.roomId)).emit("live:room:participant-joined", {
          ...socket.data.identity,
          role: "viewer",
          muted: true,
          cameraOn: false,
          joinedAt: Date.now(),
        });
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", snapshot);
        publishRooms(io);
        ack({ ok: true, data: snapshot });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:room:leave", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      leaveRoom(socket, io, parsed.data.roomId);
      ack({ ok: true, data: undefined });
    });

    socket.on("live:room:end", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      try {
        registry.end(parsed.data.roomId, socket.data.auth.userId);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:ended", {
          roomId: parsed.data.roomId,
          message: "The host ended this live.",
        });
        io.in(roomEventKey(parsed.data.roomId)).socketsLeave(roomEventKey(parsed.data.roomId));
        socket.data.roomId = null;
        publishRooms(io);
        ack({ ok: true, data: undefined });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:comment:send", (input, ack) => {
      const parsed = CommentSchema.safeParse(input);
      if (!parsed.success || !allowEvent(socket.id, "comment", MAX_CHAT_RATE_MS)) {
        ack({ ok: false, error: parsed.success ? "Wait a moment before sending another comment." : "Comments must be 1 to 240 characters." });
        return;
      }
      try {
        const comment = registry.addComment(parsed.data.roomId, socket.data.identity, parsed.data.body);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:comment", comment);
        ack({ ok: true, data: comment });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:heart:send", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success || !allowEvent(socket.id, "heart", MAX_HEART_RATE_MS)) {
        ack({ ok: false, error: parsed.success ? "Wait a moment before reacting again." : "Choose a valid live room." });
        return;
      }
      try {
        registry.getRoom(parsed.data.roomId);
        if (registry.getRoomIdForUser(socket.data.auth.userId) !== parsed.data.roomId) {
          throw new LiveRoomError("Join this live room to react.", "forbidden");
        }
        io.to(roomEventKey(parsed.data.roomId)).emit("live:heart", {
          userId: socket.data.identity.id,
          name: socket.data.identity.name,
          createdAt: Date.now(),
        });
        ack({ ok: true, data: undefined });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:stage:request", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      try {
        const request = registry.requestStage(parsed.data.roomId, socket.data.auth.userId);
        const room = registry.getRoom(parsed.data.roomId);
        const hostSocketId = registry.getSocketId(parsed.data.roomId, room.host.id);
        if (!hostSocketId) throw new LiveRoomError("The host is reconnecting. Try again shortly.", "not-found");
        io.to(hostSocketId).emit("live:stage:request", request);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", room);
        ack({ ok: true, data: request });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:stage:decision", (input, ack) => {
      const parsed = StageDecisionSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "This stage decision is invalid." });
        return;
      }
      try {
        const result = registry.decideStageRequest(
          parsed.data.roomId,
          socket.data.auth.userId,
          parsed.data.requestId,
          parsed.data.accept,
        );
        const participantSocketId = registry.getSocketId(parsed.data.roomId, result.participant.id);
        if (participantSocketId) {
          io.to(participantSocketId).emit("live:stage:decision", {
            requestId: result.request.id,
            accepted: parsed.data.accept,
            participant: result.participant,
          });
        }
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", registry.getRoom(parsed.data.roomId));
        ack({ ok: true, data: result.participant });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:stage:ready", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      try {
        const participant = registry.markStageReady(parsed.data.roomId, socket.data.auth.userId);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:stage:ready", participant);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", registry.getRoom(parsed.data.roomId));
        publishRooms(io);
        ack({ ok: true, data: participant });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:stage:decline", (input, ack) => {
      const parsed = JoinRoomSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid live room." });
        return;
      }
      try {
        const participant = registry.cancelStageInvite(parsed.data.roomId, socket.data.auth.userId);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:stage:declined", participant);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", registry.getRoom(parsed.data.roomId));
        ack({ ok: true, data: participant });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:stage:remove", (input, ack) => {
      const parsed = RemoveGuestSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Choose a valid stage member." });
        return;
      }
      try {
        const participant = registry.removeFromStage(parsed.data.roomId, socket.data.auth.userId, parsed.data.userId);
        const targetSocketId = registry.getSocketId(parsed.data.roomId, parsed.data.userId);
        if (targetSocketId) io.to(targetSocketId).emit("live:stage:removed", participant);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:room:snapshot", registry.getRoom(parsed.data.roomId));
        publishRooms(io);
        ack({ ok: true, data: participant });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:media:update", (input, ack) => {
      const parsed = MediaUpdateSchema.safeParse(input);
      if (!parsed.success) {
        ack({ ok: false, error: "Microphone or camera status is invalid." });
        return;
      }
      try {
        const participant = registry.updateMediaState(parsed.data.roomId, socket.data.auth.userId, parsed.data);
        io.to(roomEventKey(parsed.data.roomId)).emit("live:media:state", participant);
        ack({ ok: true, data: participant });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("live:signal:send", (input, ack) => {
      const parsed = SendSignalSchema.safeParse(input);
      if (!parsed.success || !allowEvent(socket.id, "signal", MAX_SIGNAL_RATE_MS)) {
        ack({ ok: false, error: parsed.success ? "Signaling is arriving too quickly. Try again." : "The connection message is invalid." });
        return;
      }
      try {
        if (registry.getRoomIdForUser(socket.data.auth.userId) !== parsed.data.roomId) {
          throw new LiveRoomError("Join this live room before connecting.", "forbidden");
        }
        const targetSocketId = registry.getSocketId(parsed.data.roomId, parsed.data.toUserId);
        if (!targetSocketId) throw new LiveRoomError("That participant is no longer in the room.", "not-found");
        io.to(targetSocketId).emit("live:signal:receive", {
          roomId: parsed.data.roomId,
          fromUserId: socket.data.auth.userId,
          signal: parsed.data.signal,
        });
        ack({ ok: true, data: undefined });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on("disconnect", () => {
      callSignalBursts.delete(socket.id);
      const roomId = registry.getRoomIdForUser(socket.data.auth.userId);
      if (roomId) leaveRoom(socket, io, roomId);
      for (const key of lastEventAt.keys()) {
        if (key.startsWith(`${socket.id}:`)) lastEventAt.delete(key);
      }
    });
  });

  io.engine.on("connection_error", (error) => {
    logger.warn({ code: error.code, message: error.message }, "Live socket connection failed");
  });
  return io;
}
