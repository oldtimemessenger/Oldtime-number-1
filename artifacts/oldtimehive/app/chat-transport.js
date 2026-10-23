// The hosting application installs its authenticated chat adapter here.
// No adapter means a queued local draft, never a simulated delivery.
// The server must verify room membership, actor IDs and read-receipt consent.
let adapter = null;
export function installChatTransport(value) {
  if (value && typeof value.send !== "function") throw new Error("Chat transport needs a send function");
  for (const key of ["isReady", "subscribe", "typing", "markRead"]) if (value?.[key] != null && typeof value[key] !== "function") throw new Error(`Chat transport ${key} must be a function`);
  adapter = value;
}
export const getChatTransport = () => adapter && (!adapter.isReady || adapter.isReady()) ? adapter : null;
export function acknowledgedStatus(current, incoming) {
  return incoming === "sent" && ["read", "delivered"].includes(current) ? current : incoming;
}
export async function submitChatMessage(conversationId, message) {
  if (!adapter) return "queued";
  const ack = await adapter.send({ conversationId, message: structuredClone(message) });
  if (ack?.accepted !== true) throw new Error("Message delivery was not acknowledged");
  return "sent";
}
export function typingNames(peers, conversation, me, user, now = Date.now()) {
  return [...new Set((Array.isArray(peers) ? peers : []).filter(peer =>
    peer && peer.userId !== me && conversation.members.includes(peer.userId) &&
    peer.typing === true && Number.isFinite(peer.expiresAt) && peer.expiresAt > now
  ).map(peer => user(peer.userId)?.name || user(peer.userId)?.username).filter(Boolean))];
}
