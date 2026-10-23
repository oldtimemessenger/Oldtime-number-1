// Authenticated live transport for chat and notification updates.
import { io } from "socket.io-client";
import { api } from "../store.js";
import { cloudApiUrl } from "../api-origin.js";

const chatListeners = new Set();
const notificationListeners = new Set();
let socket = null;
let socketToken = "";

function notifyChatListeners(update) {
  for (const listener of chatListeners) {
    try { Promise.resolve(listener(update)).catch(() => {}); } catch {}
  }
}

function ensureConnected() {
  const token = api.cloudAccessToken();
  if (!token) {
    socket?.disconnect();
    socket = null;
    socketToken = "";
    return null;
  }
  if (socket && socketToken === token) return socket;

  socket?.disconnect();
  const apiUrl = new URL(cloudApiUrl("/api/healthz"), window.location.origin);
  socketToken = token;
  socket = io(apiUrl.origin, {
    path: "/api/live/socket.io",
    transports: ["websocket", "polling"],
    auth: { accessToken: token },
    reconnection: true,
  });
  socket.on("chat:changed", notifyChatListeners);
  socket.on("notifications:changed", () => {
    for (const listener of notificationListeners) {
      try { Promise.resolve(listener()).catch(() => {}); } catch {}
    }
  });
  socket.on("connect", () => {
    notifyChatListeners({ conversationId: null });
    for (const listener of notificationListeners) {
      try { Promise.resolve(listener()).catch(() => {}); } catch {}
    }
  });
  return socket;
}

export function subscribeChatUpdates(fn) {
  chatListeners.add(fn);
  ensureConnected();
  return () => chatListeners.delete(fn);
}

export function subscribeNotificationUpdates(fn) {
  notificationListeners.add(fn);
  ensureConnected();
  return () => notificationListeners.delete(fn);
}

export function maintainSignalConnection() {
  ensureConnected();
}
