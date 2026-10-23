// Shared, pure inbox logic for Messages and Blast chats.
export const INBOX_FILTERS = ["all", "unread", "unanswered", "groups", "verified", "followers-10k"];
export const norm = (value) => String(value ?? "").toLowerCase();
// A real group has you plus at least two other people.
export const isGroupMembers = (members) => new Set(members || []).size >= 3;

export function snippetAround(text, query, radius = 48) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  const q = norm(query).trim();
  const at = q ? norm(value).indexOf(q) : -1;
  if (at < 0 || value.length <= radius * 2 + q.length) return value;
  const start = Math.max(0, at - radius), end = Math.min(value.length, at + q.length + radius);
  return `${start ? "…" : ""}${value.slice(start, end)}${end < value.length ? "…" : ""}`;
}

export function findMatchingMessage(messages, query, textOf) {
  const q = norm(query).trim();
  if (!q) return null;
  for (let i = (messages || []).length - 1; i >= 0; i--) {
    const text = String(textOf(messages[i]) ?? "");
    if (norm(text).includes(q)) return { message: messages[i], text: snippetAround(text, q) };
  }
  return null;
}

// adapters: { name(item), messages(item), textOf(msg), isGroup(item), unread(item), extra(item) }
export function filterInbox(items, { filter = "all", query = "" } = {}, adapters) {
  const q = norm(query).trim(), out = [];
  for (const item of items) {
    if (filter === "unread" && !adapters.unread(item)) continue;
    if (filter === "groups" && !adapters.isGroup(item)) continue;
    if (filter === "unanswered" && !adapters.unanswered?.(item)) continue;
    if (filter === "verified" && !adapters.verified?.(item)) continue;
    if (filter === "followers-10k" && !adapters.followers10k?.(item)) continue;
    if (!q) { out.push({ item, match: null }); continue; }
    const match = findMatchingMessage(adapters.messages(item), q, adapters.textOf);
    const named = norm(adapters.name(item)).includes(q) || norm(adapters.extra?.(item)).includes(q);
    if (match || named) out.push({ item, match });
  }
  return out;
}

export function inboxEmptyText({ filter = "all", query = "", total = 0 } = {}) {
  if (String(query).trim()) return filter === "groups" ? "No groups or group messages match your search."
    : filter === "unread" ? "No unread chats match your search." : "No chats or messages match your search.";
  if (filter === "unread") return total ? "You're all caught up. No unread chats." : "No unread chats.";
  if (filter === "groups") return "No groups yet. Create one with at least two other people.";
  if (filter === "unanswered") return "No unanswered conversations.";
  if (filter === "verified") return "No verified conversations.";
  if (filter === "followers-10k") return "No conversations with accounts over 10K followers.";
  return "No chats yet.";
}
