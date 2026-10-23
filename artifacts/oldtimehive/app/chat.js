import { api, mutate, notify } from "./store.js";
import { isStoryActive } from "./story-lifecycle.js";
import { tournamentLinkMarkup } from "./tournament-links.js";
import { openVoiceNote, voiceBody, bindVoice } from "./comms/index.js";
import { icons as ic } from "./icons.js";
import { openEmojiPicker } from "./emoji.js";
import { filterInbox, inboxEmptyText, isGroupMembers } from "./inbox-helpers.js";
import { renderSharedMessage } from "./shared-content.js";
import { toggleMessageSaved, messageIsSaved } from "./message-saves.js";
import "./message-saves.css";
import { areConsecutiveMessages } from "./chat-message-groups.js";
import { getChatTransport, installChatTransport, submitChatMessage, typingNames, acknowledgedStatus } from "./chat-transport.js";
import { subscribeChatUpdates } from "./comms/signaling.js";

const REACTS = ["❤️", "😂", "😮", "😢", "🙏", "👍", "👎"];
let ui = { reply: null, screen: "thread", q: "", call: null, filter: "all" };
let expiryTimer = null;
let stopChatSync = () => {}, typingTimer = null, lastTyping = 0;
const stateSyncs = new Map();
const stateTimers = new Map();
let activeChatView = null;
let chatUpdateQueue = Promise.resolve();
function refreshActiveChat(update) {
  const view = activeChatView;
  if (!view || view.owner !== api.cloudAccountId()) return;
  if (update.conversationId && view.conversationId && update.conversationId !== view.conversationId) return;
  chatUpdateQueue = chatUpdateQueue.catch(() => {}).then(async () => {
    if (!activeChatView || view.owner !== api.cloudAccountId()) return;
    const id = update.conversationId || view.conversationId;
    if (!id || !convo(id)) await api.refreshCloudChats({ force: true });
    const ids = id ? [id] : api.db().convos.filter(room => room.cloudBacked).slice(0, 20).map(room => room.id);
    await Promise.all(ids.map(async roomId => {
      const room = convo(roomId);
      if (room && !room.legacyArchive) await api.ensureCloudChat(room);
      return api.refreshCloudChatMessages(roomId, { force: true });
    }));
    const current = activeChatView;
    if (current && current.owner === api.cloudAccountId() &&
      (!current.conversationId || current.conversationId === id)) current.ctx.render();
  }).catch(() => {
    if (activeChatView === view) view.ctx.toast("Messages could not refresh. Check your connection and reopen the chat.");
  });
}
subscribeChatUpdates(refreshActiveChat);

function cloudChatState(conversationId) {
  const room = convo(conversationId);
  const me = api.me();
  if (!room || !me) return null;
  const reactions = {};
  const pollVotes = {};
  for (const message of room.messages || []) {
    const selected = Object.entries(message.reactions || {})
      .filter(([, userIds]) => userIds.includes(me.id))
      .map(([emoji]) => emoji);
    if (selected.length) reactions[message.id] = selected;
    const vote = Object.entries(message.poll?.votes || {}).find(([, userIds]) => userIds.includes(me.id));
    if (vote) pollVotes[message.id] = Number(vote[0]);
  }
  return {
    draft: room.draft || "",
    pinnedIds: room.pinnedIds || [],
    savedMessageIds: (room.messages || []).filter(message => messageIsSaved(message, me.id)).map(message => message.id),
    hiddenMessageIds: (room.messages || []).filter(message => message.hiddenFor?.includes(me.id)).map(message => message.id),
    keptMessageIds: (room.messages || []).filter(message => message.kept).map(message => message.id),
    disappear: room.disappear || "off",
    mutedUntil: Number(room.mutedUntil || 0),
    wallpaper: room.wallpaper || "",
    locked: !!room.locked,
    shareReceipts: api.db().settings?.readReceipts !== false,
    reactions,
    pollVotes,
  };
}

function syncCloudChatState(conversationId, ctx) {
  if (api.authMode() !== "cloud") return Promise.resolve();
  const room = convo(conversationId);
  const state = cloudChatState(conversationId);
  if (!room?.cloudBacked || !state) return Promise.resolve();
  const previous = stateSyncs.get(conversationId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => api.updateCloudChatState(conversationId, state));
  stateSyncs.set(conversationId, next);
  return next.catch(error => {
    stateSyncs.delete(conversationId);
    if (ctx?.toast) ctx.toast("Chat settings could not be synced. Try again when connected.");
    else console.error("Cloud chat state sync failed", error);
  }).finally(() => {
    if (stateSyncs.get(conversationId) === next) stateSyncs.delete(conversationId);
  });
}

function scheduleCloudChatStateSync(conversationId, ctx) {
  clearTimeout(stateTimers.get(conversationId));
  stateTimers.set(conversationId, setTimeout(() => {
    stateTimers.delete(conversationId);
    void syncCloudChatState(conversationId, ctx);
  }, 450));
}
installChatTransport({
  isReady: () => api.authMode() === "cloud",
  async send({ conversationId, message }) {
    const conversation = api.db().convos.find(item => item.id === conversationId);
    if (!conversation) throw new Error("Conversation is unavailable.");
    await api.ensureCloudChat(conversation);
    await api.sendCloudChatMessage(conversationId, message);
    return { accepted: true };
  },
});
export function closeChatTimers() { activeChatView = null; clearTimeout(expiryTimer); clearTimeout(typingTimer); stopChatSync(); stopChatSync = () => {}; }

export function ensureConvo(ids) {
  const me = api.me();
  const members = [...new Set([me.id, ...ids.filter(id => id !== me.id)])];
  if (members.some(id => !api.user(id) || api.blocked(me.id, id))) throw new Error("Contact unavailable");
  let c = api.db().convos.find(x => !x.legacyArchive &&
    x.members.length === members.length && members.every(id => x.members.includes(id)));
  if (!c) {
    c = blankConvo(members);
    mutate(db => db.convos.unshift(c));
  }
  if (api.authMode() === "cloud" && !c.cloudBacked) mutate(db => {
    const room = db.convos.find(item => item.id === c.id);
    if (room) room.cloudPending = true;
  });
  ready(c.id);
  return c.id;
}

function blankConvo(members, title) {
  return { id: "cv" + crypto.randomUUID(), members, title: title || "", messages: [], draft: "", cloudPending: api.authMode() === "cloud", pinnedIds: [], disappear: "off", mutedUntil: 0, wallpaper: "", locked: false, group: members.length > 2 ? groupMeta(title || "Group", members[0]) : null };
}
function groupMeta(name, admin) {
  return { name, description: "", admins: [admin], permissions: { send: "everyone", info: "admins", add: "admins", pin: "admins", calls: "everyone", polls: "everyone", all: "admins" }, invite: "join-" + Date.now(), approval: false, requests: [], tags: {}, history: "off" };
}
function ready(id) {
  mutate(db => {
    db.saved = db.saved || [];
    db.settings = db.settings || { readReceipts: true, lastSeen: "everyone" };
    const c = db.convos.find(x => x.id === id);
    if (!c) return;
    c.draft = c.draft || "";
    c.pinnedIds = c.pinnedIds || [];
    c.disappear = c.disappear || "off";
    db.kept = db.kept || [];
    const now = Date.now();
    c.messages = c.messages.filter(m => !(m.expiresAt && m.expiresAt <= now));
    c.mutedUntil = c.mutedUntil || 0;
    c.wallpaper = c.wallpaper || "";
    if (c.members.length > 2 && !c.group) c.group = groupMeta(c.title || "Group", c.members[0]);
    c.messages.forEach(m => {
      m.kind = m.kind || "text";
      m.status = m.status || (m.read ? "read" : "delivered");
      m.reactions = m.reactions || {};
      m.editHistory = m.editHistory || [];
    });
  });
}
const clock = (t) => new Date(t || Date.now()).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (t) => new Date(t).toDateString() === new Date().toDateString() ? "Today" : new Date(t).toLocaleDateString();
function messageDateTime(t) {
  const timestamp = new Date(t || Date.now());
  const today = new Date();
  const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayAge = Math.round((midnight(today) - midnight(timestamp)) / 86400000);
  const label = dayAge === 0 ? "Today" : dayAge === 1 ? "Yesterday" : dayAge > 1 && dayAge < 7
    ? timestamp.toLocaleDateString([], { weekday: "long" })
    : timestamp.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${label} ${clock(timestamp.getTime())}`.toUpperCase();
}
function messageDayLabel(t) {
  const timestamp = new Date(t || Date.now());
  const today = new Date();
  const midnight = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayAge = Math.round((midnight(today) - midnight(timestamp)) / 86400000);
  if (dayAge === 0) return "Today";
  if (dayAge === 1) return "Yesterday";
  return timestamp.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}
function convo(id) { return api.db().convos.find(c => c.id === id); }
function nameOf(c, me) {
  if (c.group) return c.group.name || c.title || "Group";
  return c.title || c.members.filter(id => id !== me.id).map(id => api.user(id)?.name).filter(Boolean).join(", ") || "Chat";
}
function preview(m) {
  if (!m) return "New chat";
  if (m.kind === "shared-post") return m.body || (m.sharedCommentId ? "Shared a comment" : "Shared a post");
  if (m.kind === "photo") return "Photo";
  if (m.kind === "video") return "Video";
  if (m.kind === "voice") return "Voice message";
  if (m.kind === "file") return m.fileName || "Document";
  if (m.kind === "poll") return "Poll";
  if (m.kind === "location") return "Location";
  if (m.kind === "contact") return "Contact";
  if (m.kind === "call") return m.body || "Call";
  if (m.kind === "gif") return "GIF";
  if (m.kind === "sticker") return "Sticker";
  return m.body || "";
}
function receiptText(m, me) {
  if (m.author !== me.id) return "";
  if (m.status === "read") return "Read";
  if (m.status === "delivered") return "Delivered";
  if (m.status === "failed") return "Not sent";
  return "";
}
function ttl(mode) {
  if (mode === "10 seconds") return 10e3;
  if (mode === "24 hours") return 864e5;
  if (mode === "after view") return 8e3;
  return 0;
}
function mute(ctx, id) {
  const options = ["1 hour", "8 hours", "1 day", "1 week", "Unmute"];
  menu(ctx, options, label => {
    const duration = { "1 hour": 36e5, "8 hours": 8 * 36e5, "1 day": 864e5, "1 week": 7 * 864e5 }[label] || 0;
    mutate(db => { const chat = db.convos.find(item => item.id === id); if (chat) chat.mutedUntil = duration ? Date.now() + duration : 0; });
    void syncCloudChatState(id, ctx);
    ctx.toast(duration ? `Muted for ${label}` : "Chat unmuted");
    ctx.render();
  });
}
function disappear(ctx, id) {
  menu(ctx, ["Off", "10 seconds", "24 hours", "After view"], label => {
    const mode = label === "After view" ? "after view" : label === "Off" ? "off" : label;
    mutate(db => { const chat = db.convos.find(item => item.id === id); if (chat) chat.disappear = mode; });
    void syncCloudChatState(id, ctx);
    ctx.toast(mode === "off" ? "Disappearing messages turned off" : `Disappearing messages: ${label}`);
    ctx.render();
  });
}
export function logCall(id, label) {
  pushMsg(id, { kind: "call", body: label });
}
function pushMsg(id, msg, ownerId = api.me()?.id) {
  const me = api.me();
  const current = convo(id);
  if (!me) throw new Error("Sign in again to send messages.");
  if (!current?.members.includes(me.id) || me.id !== ownerId) throw new Error("Chat unavailable. Reopen the conversation and try again.");
  if (current.members.some(uid => api.blocked(me.id, uid))) throw new Error("You can no longer message this account.");
  if (current.legacyArchive) throw new Error("This private archive is read-only.");
  msg.id = msg.id || "m" + crypto.randomUUID();
  msg.kind = msg.kind || "text";
  msg.created = Date.now();
  msg.author = msg.author || api.me().id;
  msg.status = getChatTransport() ? "sending" : "queued";
  msg.reactions = msg.reactions || {};
  msg.editHistory = msg.editHistory || [];
  msg.kept = false;
  const mode = convo(id)?.disappear || "off";
  if (mode !== "off" && mode !== "after view") msg.expiresAt = Date.now() + ttl(mode);
  if (msg.kind && msg.kind !== "text") { msg.fileSize = msg.fileSize || ""; msg.body = msg.body || msg.kind; }
  mutate(db => {
    const c = db.convos.find(x => x.id === id);
    if (!c) throw new Error("Chat unavailable. Reopen the conversation and try again.");
    c.messages.push(msg);
    c.draft = "";
  });
  void syncCloudChatState(id);
  void deliverMessage(id, msg);
}
async function deliverMessage(id, message) {
  const owner = api.me()?.id;
  let status;
  try { status = await submitChatMessage(id, message); } catch { status = "failed"; }
  if (api.me()?.id !== owner) return;
  mutate(db => {
    const target = db.convos.find(room => room.id === id && room.members.includes(owner))?.messages.find(item => item.id === message.id);
    if (target) {
      status = acknowledgedStatus(target.status, status);
      target.status = status;
      if (status === "sent" && api.authMode() === "cloud") target.cloudSynced = true;
    }
  });
  if (status === "sent" && api.authMode() === "cloud") void syncCloudChatState(id);
  const bubble = [...document.querySelectorAll("[data-msg]")].find(el => el.dataset.msg === message.id);
  const label = bubble?.closest(".message-row")?.querySelector(".message-status") || bubble?.querySelector(".message-status");
  if (label) label.textContent = receiptText({ ...message, status }, api.me());
}
function wireThreadStatus(ctx, c, me) {
  stopChatSync(); stopChatSync = () => {};
  const transport = getChatTransport(), box = ctx.$("#msgs");
  if (!transport || !box) return;
  const label = document.createElement("div"); label.className = "chat-typing-status"; label.setAttribute("role", "status"); label.hidden = true; box.before(label);
  const active = () => api.me()?.id === me.id && ctx.$("#msgs")?.dataset.convo === c.id;
  const cleanup = transport.subscribe?.({ conversationId: c.id,
    onTyping: peers => {
      if (!active()) return;
      const names = typingNames(peers, c, me.id, id => api.blocked(me.id, id) ? null : api.user(id));
      label.textContent = names.length ? `${names.join(", ")} ${names.length === 1 ? "is" : "are"} typing…` : ""; label.hidden = !names.length;
      clearTimeout(typingTimer); typingTimer = setTimeout(() => { label.hidden = true; }, 8000);
    },
    onReceipt: receipt => {
      if (!active() || !c.members.includes(receipt?.userId) || receipt.userId === me.id || !["read", "delivered"].includes(receipt.status)) return;
      mutate(db => {
        const message = db.convos.find(room => room.id === c.id)?.messages.find(item => item.id === receipt.messageId && item.author === me.id);
        if (!message) return;
        message.receipts = { ...message.receipts, [receipt.userId]: message.receipts?.[receipt.userId] === "read" ? "read" : receipt.status };
        const others = c.members.filter(id => id !== me.id);
        message.status = others.every(id => message.receipts[id] === "read") ? "read" : others.every(id => ["read", "delivered"].includes(message.receipts[id])) ? "delivered" : "sent";
        const bubble = [...ctx.app.querySelectorAll("[data-msg]")].find(el => el.dataset.msg === message.id);
        const status = bubble?.closest(".message-row")?.querySelector(".message-status") || bubble?.querySelector(".message-status");
        if (status) status.textContent = receiptText(message, me);
      });
    },
    onError: () => { if (active()) ctx.toast("Chat connection unavailable"); }
  });
  stopChatSync = () => { if (typeof cleanup === "function") cleanup(); clearTimeout(typingTimer); label.remove(); };
  Promise.resolve(transport.markRead?.({ conversationId: c.id, shareReceipts: api.db().settings?.readReceipts !== false })).catch(() => {});
}

let menuCleanup = null;
export function openChatList(ctx) {
  menuCleanup?.();
  ui.screen = "list";
  if (api.authMode() === "cloud") {
    void api.refreshCloudChats().then(changed => {
      const migration = api.legacyChatMigrationStatus?.();
      if (migration?.pending && ui.screen === "list") {
        ctx.toast?.(`${migration.pending} older chat${migration.pending === 1 ? "" : "s"} could not be verified in the cloud; the originals were kept.`);
      }
      if (changed && ui.screen === "list") refreshActiveChat({ conversationId: null });
    }).catch(() => ctx.toast?.("Messages are temporarily unavailable. Check your connection and try again."));
  }
  const me = api.me();
  api.db().convos.filter(c => c.members.includes(me.id)).forEach(c => ready(c.id));
  const rows = api.db().convos.filter(c => c.members.includes(me.id) && !c.locked &&
    (c.legacyArchive || !c.members.some(id => api.blocked(me.id, id))))
    .sort((a, b) => (b.messages.at(-1)?.created || 0) - (a.messages.at(-1)?.created || 0));
  const folderFor = c => {
    if (c.group || isGroupMembers(c.members)) return "general";
    const other = c.members.find(id => id !== me.id);
    return other && api.areFriends(me.id, other) ? "primary" : "requests";
  };
  const folderRows = folder => folder === "all" ? rows : rows.filter(c => folderFor(c) === folder);
  const folderUnread = Object.fromEntries(["primary", "requests", "general"].map(folder => [
    folder, folderRows(folder).reduce((sum, conversation) => sum + unreadCount(conversation, me), 0)
  ]));
  const locked = api.db().convos.filter(c => c.members.includes(me.id) && c.locked && !c.members.some(id => api.blocked(me.id, id)));
  const notePeople = [
    me,
    ...api.db().users.filter(person => person.id !== me.id && person.profileNote?.trim() && api.canSee(person.id))
  ];
  const noteCards = notePeople.map(person => chatNoteCard(person, me)).join("");
  ctx.shell(`<section class="screen on light chat-list-screen"><div class="scroll page">
    <div class="chat-list-heading">
      <div class="chat-list-topline">
        <h1 class="chat-title">Messages</h1>
        <div class="chat-head-actions">
          <button class="chat-head-icon" id="toggle-chat-search" aria-label="Search messages" title="Search messages" aria-expanded="false" aria-controls="chat-search-panel">${ic.search}</button>
          <button type="button" class="chat-head-icon" id="chat-filter-open" aria-label="Filters" title="Filters" aria-haspopup="dialog" aria-expanded="false" aria-controls="chat-more-menu">${ic.settings}</button>
          <div class="chat-options">
            <button type="button" class="chat-options-backdrop" id="chat-options-backdrop" aria-label="Close message filters" hidden></button>
            <div class="chat-options-menu" id="chat-more-menu" role="dialog" aria-modal="true" aria-label="Message filters" hidden>
              <div class="chat-filter-sheet-handle" aria-hidden="true"></div>
              <div class="chat-filter-sheet-heading"><h2>Filters</h2><button type="button" class="chat-filter-close" id="close-chat-filter" aria-label="Close filters">${ic.close}</button></div>
              <div class="chat-filter-options" role="radiogroup" aria-label="Filter conversations">
                <button type="button" class="chat-option" role="radio" aria-checked="true" data-more-filter="all"><span class="chat-option-icon">${ic.menu}</span><span>Every chat</span><i class="chat-option-radio" aria-hidden="true"></i></button>
                <button type="button" class="chat-option" role="radio" aria-checked="false" data-more-filter="unread"><span class="chat-option-icon">${ic.bell || ""}</span><span>Unread</span><i class="chat-option-radio" aria-hidden="true"></i></button>
                <button type="button" class="chat-option" role="radio" aria-checked="false" data-more-filter="unanswered"><span class="chat-option-icon">${ic.comment}</span><span>Unanswered</span><i class="chat-option-radio" aria-hidden="true"></i></button>
                <button type="button" class="chat-option chat-option-unavailable" disabled aria-disabled="true" title="Story replies are not connected to inbox filtering yet"><span class="chat-option-icon">${ic.comment}</span><span>Story replies</span><small>Not connected</small></button>
                <button type="button" class="chat-option" role="radio" aria-checked="false" data-more-filter="verified"><span class="chat-option-icon">${ic.check}</span><span>Verified profiles</span><i class="chat-option-radio" aria-hidden="true"></i></button>
                <button type="button" class="chat-option" role="radio" aria-checked="false" data-more-filter="followers-10k"><span class="chat-option-icon">${ic.users}</span><span>10K+ followers</span><i class="chat-option-radio" aria-hidden="true"></i></button>
              </div>
              <button type="button" class="chat-see-more" id="chat-see-more" aria-expanded="false">See more</button>
              <div class="chat-advanced-filters" id="chat-advanced-filters" hidden>
                <button type="button" class="chat-option" role="radio" aria-checked="false" data-more-filter="groups">${ic.users}<span>Groups</span><i class="chat-option-radio" aria-hidden="true"></i></button>
              </div>
              <div class="chat-sheet-folders">
                <button type="button" class="chat-sheet-folders-toggle" id="more-folders" aria-expanded="true"><b>Folders</b><span class="chat-sheet-chevron" aria-hidden="true"></span></button>
                <div class="chat-folder-options" id="chat-folder-options">
                   ${[["primary","Primary"],["requests","Requests"],["general","General"]].map(([id,label])=>`<button type="button" data-inbox-folder="${id}" aria-pressed="false">${label}${folderUnread[id] ? `<span>${folderUnread[id]}</span>` : ""}</button>`).join("")}
                </div>
              </div>
              <section class="chat-organize-card" aria-label="Organize messages">
                <span class="chat-organize-icon">${ic.bookmark}</span>
                <div><b>Organize your messages</b><p>Use Saved for messages you want to find again. Custom folders are not available yet.</p></div>
                <button type="button" id="more-saved">Open Saved</button>
              </section>
            </div>
          </div>
          <button class="chat-head-icon" id="newchat" aria-label="New message" title="New message">${ic.edit}</button>
        </div>
      </div>
      <label class="chat-search-wrap" id="chat-search-panel" hidden>${ic.search}<input class="chatsearch" id="cq" placeholder="Search chats or messages" aria-label="Search chats or messages" /></label>
    </div>
    <div class="chat-list-body">
      <div class="chat-note-field"><div class="chat-note-track" aria-label="Profile notes"><div class="chat-note-items">${noteCards}</div></div></div>
      <div class="chat-inbox-toolbar">
        <div class="chat-inbox-tabs" role="group" aria-label="Message folders">
          ${[["primary","Primary"],["requests","Requests"],["general","General"]].map(([id,label])=>`<button type="button" class="chat-inbox-tab" aria-pressed="false" data-inbox-folder="${id}">${label}${folderUnread[id] ? `<span>${folderUnread[id]}</span>` : ""}</button>`).join("")}
        </div>
      </div>
      ${locked.map(c => `<button class="listbtn" data-unlock="${c.id}">Show hidden chat · ${ctxEsc(nameOf(c, me))}</button>`).join("")}
      <div id="crows">${rows.map(c => row(c, me)).join("") || `<div class="empty">No chats yet.</div>`}</div>
    </div>
  </div></section>`, "light");
  let listFilter = "all", activeFolder = "all";
  ctx.$("#newchat").onclick = () => pick(ctx, false);
  const textOf = m => m.body || preview(m);
  const adapters = {
    name: c => nameOf(c, me), extra: c => c.draft || "", unread: c => unreadCount(c, me) > 0, isGroup: c => Boolean(c.group) || isGroupMembers(c.members),
    unanswered: c => { const last = c.messages.filter(m => !m.hiddenFor?.includes(me.id)).at(-1); return !!last && last.author === me.id; },
    otherUser: c => { const otherId = c.members.find(id => id !== me.id); return otherId ? api.user(otherId) : null; },
    verified: c => !isGroupMembers(c.members) && Boolean(adapters.otherUser(c)?.verified),
    followers10k: c => { if (isGroupMembers(c.members)) return false; const followers = adapters.otherUser(c)?.followers; return (Array.isArray(followers) ? followers.length : Number(followers) || 0) >= 10000; },
    messages: c => c.messages.filter(m => !m.hiddenFor?.includes(me.id) && !(m.expiresAt <= Date.now())), textOf
  };
  const syncFolderSelection = () => {
    ctx.app.querySelectorAll("[data-inbox-folder]").forEach(button => {
      const selected = button.dataset.inboxFolder === activeFolder;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    const filterButton = ctx.$("#chat-filter-open");
    filterButton.setAttribute("aria-pressed", String(listFilter !== "all"));
    if (activeFolder === "all") filterButton.setAttribute("aria-current", "page");
    else filterButton.removeAttribute("aria-current");
  };
  const renderRows = () => {
    const query = ctx.$("#cq").value.trim().toLowerCase();
    const scoped = folderRows(activeFolder);
    const found = filterInbox(scoped, { filter: listFilter, query }, adapters);
    const empty = found.length ? "" : scoped.length && listFilter === "groups" && activeFolder !== "general"
      ? "No group chats in this folder."
      : !scoped.length ? activeFolder === "all" ? "No conversations yet."
        : `No ${activeFolder === "primary" ? "primary" : activeFolder === "requests" ? "request" : "general"} conversations yet.`
      : inboxEmptyText({ filter: listFilter, query, total: scoped.length });
    ctx.$("#crows").innerHTML = found.map(({ item, match }) => row(item, me, query, match)).join("") || `<div class="empty">${ctxEsc(empty)}</div>`;
    bindRows(ctx);
  };
  const setFilter = value => {
    listFilter = value;
    if (value === "all") activeFolder = "all";
    ctx.app.querySelectorAll("[data-chat-filter]").forEach(b => { const on = b.dataset.chatFilter === value; b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); });
    ctx.app.querySelectorAll("[data-more-filter]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.moreFilter === value)));
    syncFolderSelection();
    renderRows();
  };
  menuCleanup?.();
  const filterOpen = ctx.$("#chat-filter-open"), closeFilter = ctx.$("#close-chat-filter");
  const menu = ctx.$("#chat-more-menu"), backdrop = ctx.$("#chat-options-backdrop");
  const searchPanel = ctx.$("#chat-search-panel"), searchInput = ctx.$("#cq"), searchButton = ctx.$("#toggle-chat-search");
  let returnFocus = filterOpen;
  const setMenu = (open, focusButton = false) => {
    menu.hidden = !open;
    backdrop.hidden = !open;
    ctx.$(".chat-list-heading").classList.toggle("filters-open", open);
    filterOpen.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("[data-more-filter]:not(:disabled)")?.focus();
    else if (focusButton) returnFocus.focus();
  };
  const closeSearch = (focusButton = false) => {
    if (searchPanel.hidden) return;
    searchPanel.hidden = true;
    searchInput.value = "";
    searchButton.setAttribute("aria-expanded", "false");
    if (ctx.$("#crows")) renderRows();
    if (focusButton) searchButton.focus();
  };
  const outside = e => { if (!menu.hidden && !e.target.closest?.(".chat-options") && !e.target.closest?.("#chat-filter-open")) setMenu(false); };
  const searchOutside = e => {
    const currentPanel = ctx.$("#chat-search-panel");
    if (currentPanel && !currentPanel.hidden && !e.target.closest?.("#chat-search-panel") && !e.target.closest?.("#toggle-chat-search")) closeSearch();
  };
  const esc = e => {
    if (e.key !== "Escape") return;
    if (!menu.hidden) { e.preventDefault(); setMenu(false, true); }
    else if (!searchPanel.hidden) { e.preventDefault(); closeSearch(true); }
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("click", searchOutside);
  document.addEventListener("keydown", esc);
  menuCleanup = () => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("click", searchOutside);
    document.removeEventListener("keydown", esc);
    menuCleanup = null;
  };
  filterOpen.onclick = () => { returnFocus = filterOpen; setMenu(menu.hidden); };
  closeFilter.onclick = () => setMenu(false, true);
  backdrop.onclick = () => setMenu(false, true);
  menu.onkeydown = e => {
    const items = [...menu.querySelectorAll("button:not(:disabled)")].filter(button => !button.closest("[hidden]")), i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  };
  menu.querySelectorAll("[data-more-filter]:not(:disabled)").forEach(b => b.onclick = () => { setFilter(b.dataset.moreFilter); setMenu(false, true); });
  ctx.$("#more-saved").onclick = () => { setMenu(false); saved(ctx); };
  ctx.$("#chat-see-more").onclick = e => {
    const advanced = ctx.$("#chat-advanced-filters");
    advanced.hidden = !advanced.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!advanced.hidden));
  };
  ctx.$("#more-folders").onclick = e => {
    const folders = ctx.$("#chat-folder-options");
    folders.hidden = !folders.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!folders.hidden));
  };
  searchButton.onclick = () => {
    if (!searchPanel.hidden) return closeSearch(true);
    searchPanel.hidden = false;
    searchButton.setAttribute("aria-expanded", "true");
    searchInput.focus();
  };
  ctx.app.querySelectorAll("[data-unlock]").forEach(b => b.onclick = () => { mutate(db => { db.convos.find(x => x.id === b.dataset.unlock).locked = false; }); ui.screen = "thread"; ctx.setChat(b.dataset.unlock); });
  ctx.$("#cq").oninput = renderRows;
  ctx.app.querySelectorAll("[data-inbox-folder]").forEach(button => button.onclick = () => {
    activeFolder = button.dataset.inboxFolder;
    syncFolderSelection();
    renderRows();
  });
  setFilter("all");
  ctx.app.querySelectorAll("[data-chat-note]").forEach(button => button.onclick = () => {
    if (button.dataset.chatNote === me.id) {
      if (ctx.editProfileNote) return ctx.editProfileNote();
      return ctx.toast("Note editor unavailable");
    }
    ctx.openProfile?.(button.dataset.chatNote);
  });
  activeChatView = { ctx, conversationId: null, owner: api.cloudAccountId() };
}
function chatNoteCard(person, me) {
  const isMe = person.id === me.id;
  const note = person.profileNote?.trim() || "";
  const fallbackNote = "Add a note";
  const label = isMe
    ? `Your note: ${note || fallbackNote}. ${note ? "Edit" : "Add"} your note here.`
    : `${person.name || person.username}'s note: ${note}. Open profile.`;
  return `<button class="chat-note-person" type="button" data-chat-note="${ctxEsc(person.id)}" aria-label="${ctxEsc(label)}">
    <span class="chat-note-avatar-wrap">
      <img class="chat-note-avatar" src="${ctxEsc(person.avatar || "")}" alt="" />
      <span class="profile-note-bubble chat-note-bubble ${note ? "" : "empty"}"${note ? ` title="${ctxEsc(note)}"` : ""}><span class="chat-note-bubble-text">${ctxEsc(note || fallbackNote)}</span></span>
    </span>
    <span class="chat-note-name">${isMe ? "Your note" : ctxEsc(person.name || person.username)}</span>
  </button>`;
}
function unreadCount(c, me) {
  if (c.legacyArchive) return 0;
  return c.messages.filter(m => !m.hiddenFor?.includes(me.id) && m.author !== me.id && m.status !== "read" && !m.read).length;
}
function row(c, me, query = "", match = null) {
  const visible = c.messages.filter(m => !m.hiddenFor?.includes(me.id));
  const last = visible.at(-1);
  const unread = unreadCount(c, me);
  const matchedMessage = match?.message || null;
  const shownMessage = matchedMessage || last;
  const time = shownMessage ? inboxTime(shownMessage.created) : "";
  let text = c.legacyArchive
    ? `Private archive · ${last ? preview(last) : c.draft ? "Unsent draft" : "No messages"}`
    : c.draft ? `Draft: ${c.draft}` : "";
  if (c.legacyArchive) {
    if (matchedMessage) text = match.text;
  } else if (matchedMessage) text = match.text;
  else if (!c.draft && unread) text = `${unread} new message${unread === 1 ? "" : "s"}`;
  else if (!c.draft && last?.author === me.id) {
    const state = last.status === "read" ? "Seen" : "Sent";
    text = time === "now" ? `${state} just now` : `${state} ${time} ago`;
  } else if (!c.draft) text = preview(last);
  const others = c.members.filter(id => id !== me.id).map(api.user).filter(Boolean);
  const storyPerson = others[0];
  const conversationName = nameOf(c, me);
  const storyName = storyPerson?.name || storyPerson?.username || conversationName;
  const muted = c.mutedUntil > Date.now();
  const hasStory = Boolean(storyPerson && api.stories().some(story =>
    story.author === storyPerson.id &&
    isStoryActive(story) &&
    api.canSeeStory(story)
  ));
  const age = matchedMessage || (last && (unread || last.author !== me.id)) ? ` · ${time}` : "";
  return `<div class="chat-inbox-row" data-inbox-row="${ctxEsc(c.id)}">
    <button type="button" class="chat-inbox-avatar ${hasStory ? "has-story" : ""}" ${hasStory
      ? `data-inbox-story="${ctxEsc(storyPerson.id)}" aria-label="View ${ctxEsc(storyName)}'s story"`
      : storyPerson && !isGroupMembers(c.members)
        ? `data-inbox-profile="${ctxEsc(storyPerson.id)}" aria-label="Open ${ctxEsc(storyName)}'s profile"`
        : `data-cv="${ctxEsc(c.id)}" aria-label="Open chat with ${ctxEsc(conversationName)}"`}>
      <img src="${ctxEsc(storyPerson?.avatar || me.avatar)}" alt="" />
    </button>
    <button type="button" class="chat-inbox-main" data-cv="${ctxEsc(c.id)}"${matchedMessage ? ` data-cv-msg="${ctxEsc(matchedMessage.id)}"` : ""}>
      <span class="chat-inbox-copy">
        <b>${ctxEsc(conversationName)}</b>
        <span class="chat-inbox-preview ${unread ? "is-unread" : ""}">${ctxEsc(text)}${age ? `<span class="chat-inbox-age">${ctxEsc(age)}</span>` : ""}${muted ? `<span class="chat-inbox-muted"> · Muted</span>` : ""}</span>
      </span>
      ${unread ? `<span class="chat-inbox-unread-dot" aria-label="${unread} unread messages"></span>` : ""}
    </button>
  </div>`;
}
function inboxTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - (timestamp || Date.now()));
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}
function bindRows(ctx) {
  ctx.app.querySelectorAll("[data-cv]").forEach(b => b.onclick = () => {
    ui.screen = "thread"; ctx.setChat(b.dataset.cv);
    const target = b.dataset.cvMsg;
    if (target) setTimeout(() => { const el = [...document.querySelectorAll("[data-msg]")].find(x => x.dataset.msg === target); el?.scrollIntoView?.({ block: "center" }); }, 0);
  });
  ctx.app.querySelectorAll("[data-inbox-row]").forEach(row => row.onclick = event => {
    if (event.target.closest("button")) return;
    ui.screen = "thread";
    ctx.setChat(row.dataset.inboxRow);
  });
  ctx.app.querySelectorAll("[data-inbox-story]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    if (typeof ctx.openStory !== "function") return ctx.toast("Story viewer is unavailable.");
    ctx.openStory(button.dataset.inboxStory);
  });
  ctx.app.querySelectorAll("[data-inbox-profile]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    ctx.openProfile(button.dataset.inboxProfile);
  });
}
function ctxEsc(s = "") { return String(s).replace(/&/g, "&" + "amp;").replace(/</g, "&" + "lt;").replace(/>/g, "&" + "gt;").replace(/"/g, "&" + "quot;"); }

export function openThread(id, ctx) {
  const allowed = convo(id);
  if (!allowed?.members.includes(api.me()?.id) || (!allowed.legacyArchive && allowed.members.some(uid => api.blocked(api.me().id, uid)))) { ui.screen = "list"; ctx.setChat(null); ctx.toast("Chat unavailable"); return; }
  ready(id);
  if (api.authMode() === "cloud" && !allowed.legacyArchive) {
    void api.ensureCloudChat(allowed).then(() => api.refreshCloudChatMessages(id)).then(changed => {
      void api.markCloudChatRead(id, api.db().settings?.readReceipts !== false).catch(() => {});
      if (changed && ui.screen === "thread" && ctx.$("#msgs")?.dataset.convo === id) ctx.render();
    }).catch(() => ctx.toast?.("Chat history is temporarily unavailable. Check your connection and try again."));
  }
  if (ui.screen === "info") return info(ctx, id);
  if (ui.screen === "search") return search(ctx, id);
  if (ui.screen === "media") return media(ctx, id);
  if (ui.screen === "group") return group(ctx, id);
  const c = convo(id);
  const me = api.me();
  const ownerId = me.id;
  if (c.legacyArchive) ui.reply = null;
  const other = api.user(c.members.find(x => x !== me.id)) || me;
  if (!c.legacyArchive) mutate(db => db.convos.find(x => x.id === id).messages.forEach(m => { if (m.author !== me.id && !m.kept) { m.read = true; if (db.settings.readReceipts !== false) m.status = "read"; if ((db.convos.find(x => x.id === id).disappear === "after view") && !m.expiresAt) m.expiresAt = Date.now() + 8000; } }));
  const pin = c.messages.find(m => (c.pinnedIds || []).includes(m.id));
  const presence = c.group ? c.members.length + " participants" : "";
  const threadMessageMarkup = messages(c, me);
  const firstMessagePrompt = !threadMessageMarkup && !c.legacyArchive
    ? `<div class="chat-empty-intro"><p>Say hi by sending a sticker</p><button type="button" class="chat-hello-sticker" id="send-hi-sticker" aria-label="Send a waving hand sticker" title="Send hi"><span class="emoji" aria-hidden="true">👋</span></button></div>`
    : "";
  ctx.shell(`<section class="screen on conversation-screen" style="background:#fff;color:#202326">
    <div class="chat-header">
      <button id="back" class="chat-back" aria-label="Back to chats">${ic.back}</button>
       <button id="info" class="chat-identity" aria-label="${c.legacyArchive ? "Archived conversation" : "Open chat details"}"${c.legacyArchive ? " disabled" : ""}>
        <span class="chat-avatar-wrap"><img class="chat-avatar" src="${ctxEsc(c.group ? (api.user(c.members.find(x => x !== me.id))?.avatar || other.avatar) : other.avatar)}" alt="" /></span>
         <span class="chat-identity-copy"><b><span class="chat-identity-name">${ctxEsc(c.group ? nameOf(c, me) : other.name)}</span>${other.verified && !c.group ? `<span class="verified" aria-label="Verified">${ic.check}</span>` : ""}</b><span class="chat-subtitle">${c.legacyArchive ? "Private archive · only visible to you" : c.group ? presence : "@" + ctxEsc(other.username)}</span></span>
      </button>
      <div class="chat-actions">
        <button id="find" class="chat-action" aria-label="Search this chat">${ic.search}</button>
        <button id="more" class="chat-action" aria-label="More chat options">${ic.more}</button>
      </div>
    </div>
    ${pin ? `<button class="pinbar" id="pinjump">Pinned · ${ctxEsc(preview(pin))}</button>` : ""}
     ${c.legacyArchive && c.draft ? `<aside class="chat-archive-draft"><b>Unsent draft</b><span>${ctxEsc(c.draft)}</span></aside>` : ""}
    <div class="scroll conversation-messages" id="msgs" data-convo="${id}">${threadMessageMarkup}${firstMessagePrompt}</div>
    ${ui.reply ? `<div class="replybar">Reply · ${ctxEsc(preview(c.messages.find(m => m.id === ui.reply) || {}))}<button id="clearrep" aria-label="Cancel reply">${ic.close}</button></div>` : ""}
     ${c.legacyArchive
        ? `<aside class="chat-archive-notice" role="note"><b>Private archive</b><span>This old conversation is saved to your account and is visible only to you. It is read-only.</span><button type="button" class="chat-archive-new" id="new-chat-from-archive">Start a new chat</button></aside>`
       : `<form id="send" class="composer chat-composer"><button type="button" id="emoji" aria-label="Emoji and stickers">${ic.smile}</button><button type="button" id="attach" aria-label="Add media or document">${ic.image}</button><textarea id="msg" rows="1" aria-label="Message" placeholder="Message">${ctxEsc(c.draft || "")}</textarea><button type="button" id="mic" aria-label="Record voice note">${ic.mic}</button><button type="submit" aria-label="Send message">${ic.sendUp}</button></form>`}
  </section>`, "light");
  void import("./local-media.js").then(({ hydrateLocalMedia }) => hydrateLocalMedia(ctx.app)).catch(() => {});
  ctx.$("#back").onclick = () => { ui.screen = "list"; ui.reply = null; ctx.setChat(null); };
  if (!c.legacyArchive && ctx.$("#send-hi-sticker")) ctx.$("#send-hi-sticker").onclick = () => {
    try { pushMsg(id, { kind: "sticker", body: "👋" }, ownerId); ctx.render(); }
    catch (error) { ctx.toast(error.message || "Sticker could not be sent. Try again."); }
  };
  if (!c.legacyArchive) ctx.$("#info").onclick = () => { ui.screen = "info"; ctx.render(); };
  ctx.$("#find").onclick = () => { ui.screen = "search"; ctx.render(); };
  ctx.$("#more").onclick = () => menu(ctx, c.legacyArchive
    ? ["Delete archived conversation"]
    : ["Chat info", "Search", "Mute", "Disappearing messages", "Hide chat"], (label) => {
    if (c.legacyArchive && label === "Delete archived conversation") {
      if (!globalThis.confirm?.("Delete this private archived conversation from your account? This cannot be undone.")) return;
      void api.deleteCloudLegacyChatArchive(id).then(() => {
        ui.screen = "list";
        ui.reply = null;
        ctx.setChat(null);
        ctx.toast("Archived conversation deleted");
      }).catch(error => ctx.toast(error.message || "The archive could not be deleted."));
      return;
    }
    if (label === "Chat info") ui.screen = "info";
    if (label === "Search") ui.screen = "search";
    if (label === "Mute") return mute(ctx, id);
    if (label === "Disappearing messages") return disappear(ctx, id);
    if (label === "Hide chat") { mutate(db => { db.convos.find(x => x.id === id).locked = true; }); ui.screen = "list"; ctx.setChat(null); return; }
    ctx.render();
  });
  if (!c.legacyArchive) {
  }
  if (ctx.$("#pinjump")) ctx.$("#pinjump").onclick = () => jump(c.pinnedIds[0]);
  if (ctx.$("#clearrep")) ctx.$("#clearrep").onclick = () => { ui.reply = null; ctx.render(); };
  if (c.legacyArchive) {
    ctx.$("#new-chat-from-archive").onclick = () => pick(ctx, false, {
      initialId: other?.cloudAccountId ? other.id : "",
      initialQuery: other?.username || "",
    });
  } else ctx.$("#emoji").onclick = () => openEmojiPicker(ctx.$("#msg"), () => {}, {
    chat: true,
    onSticker: emoji => { pushMsg(id, { kind: "sticker", body: emoji }); ctx.render(); }
  });
  if (!c.legacyArchive) {
    ctx.$("#attach").onclick = () => attach(ctx, id);
    ctx.$("#mic").onclick = () => openVoiceNote(ctx, id, pushMsg);
  }
  const messageInput = ctx.$("#msg");
  const resizeMessageInput = () => {
    if (!messageInput) return;
    messageInput.style.height = "auto";
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 112)}px`;
    messageInput.style.overflowY = messageInput.scrollHeight > 112 ? "auto" : "hidden";
  };
  if (messageInput) {
    resizeMessageInput();
    messageInput.onkeydown = e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }
    };
  }
  if (!c.legacyArchive) ctx.$("#msg").oninput = (e) => {
    resizeMessageInput();
    const value = e.target.value;
    const current = convo(id);
    if (current && api.me()?.id === ownerId) {
      mutate(db => {
        const room = db.convos.find(x => x.id === id);
        if (room) room.draft = value;
      });
      scheduleCloudChatStateSync(id, ctx);
    }
    const transport = getChatTransport();
    if (transport?.typing && Date.now() - lastTyping > 1500) { lastTyping = Date.now(); Promise.resolve(transport.typing({ conversationId: id, typing: !!value.trim() })).catch(() => {}); }
  };
  if (!c.legacyArchive) ctx.$("#send").onsubmit = (e) => {
    e.preventDefault();
    const body = ctx.$("#msg").value.trim();
    if (!body) return;
    try {
      pushMsg(id, { kind: "text", body, replyTo: ui.reply }, ownerId);
      ui.reply = null;
      ctx.render();
    } catch (error) {
      ctx.toast(error.message || "Message could not be sent. Try again.");
    }
  };
  ctx.app.querySelectorAll("[data-msg]").forEach(b => {
    b.onclick = () => onMessage(ctx, id, b.dataset.msg);
    b.onkeydown = e => { if (e.target === b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onMessage(ctx, id, b.dataset.msg); } };
  });
  ctx.app.querySelectorAll("[data-react-msg]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    react(id, b.dataset.reactMsg, b.dataset.reactEmoji, ctx);
    ctx.render();
  });
  ctx.app.querySelectorAll(".message-media, .message-file").forEach(el => el.onclick = e => e.stopPropagation());
  ctx.app.querySelectorAll("[data-chat-shared-post]").forEach(button => button.onclick = event => {
    event.stopPropagation();
    const post = api.post(button.dataset.chatSharedPost);
    if (!post || !api.canSeePost(post)) return ctx.toast("Post unavailable");
    ctx.openSharedPost?.(post.id, button.dataset.chatSharedComment || "");
  });
  bindVoice(ctx.app);
   ctx.app.querySelectorAll("[data-vote]").forEach(b => b.onclick = (e) => { e.stopPropagation(); const [mid, i] = b.dataset.vote.split(":"); vote(id, mid, +i, ctx); ctx.render(); });
   ctx.app.querySelectorAll("[data-retry]").forEach(button => {
     const retryMessage = event => {
       event.stopPropagation();
       const message = convo(id)?.messages.find(item => item.id === button.dataset.retry);
       if (!message || message.status !== "failed") return;
       mutate(db => {
         const retrying = db.convos.find(item => item.id === id)?.messages.find(item => item.id === button.dataset.retry);
         if (retrying) retrying.status = "sending";
       });
       ctx.render();
       void deliverMessage(id, message).then(() => { if (ctx.$("#msgs")?.dataset.convo === id) ctx.render(); });
     };
     button.onclick = retryMessage;
   });
  if (!c.legacyArchive) wireThreadStatus(ctx, c, me);
  activeChatView = { ctx, conversationId: id, owner: api.cloudAccountId() };
  const box = ctx.$("#msgs"); if (box) box.scrollTop = box.scrollHeight;
  const nextExpiry = Math.min(...c.messages.filter(m => m.expiresAt).map(m => m.expiresAt));
  if (Number.isFinite(nextExpiry)) expiryTimer = setTimeout(() => { if (ctx.$("#msgs")?.dataset.convo === id) ctx.render(); }, Math.max(1, nextExpiry - Date.now() + 20));
}
function messages(c, me) {
  let lastDay = "", unread = false;
  const visible = c.messages.filter(m => !m.hiddenFor?.includes(me.id));
  return visible.map((m, index) => {
    const bits = [];
    const d = day(m.created);
    const previous = visible[index - 1];
    const next = visible[index + 1];
    const startsCluster = !areConsecutiveMessages(previous, m);
    const endsCluster = !areConsecutiveMessages(m, next);
    if (d !== lastDay) {
      lastDay = d;
      bits.push(`<div class="datesep chat-group-time">${ctxEsc(messageDayLabel(m.created))}</div>`);
    }
    if (m.kind === "system") {
      bits.push(bubble(m, c, me));
      return bits.join("");
    }
    if (!unread && m.author !== me.id && m.status !== "read" && !m.read) { unread = true; bits.push(`<div class="datesep">Unread</div>`); }
    bits.push(bubble(m, c, me, { startsCluster, endsCluster }));
    return bits.join("");
  }).join("");
}
function bubble(m, c, me, cluster = {}) {
  if (m.kind === "system") return `<div class="datesep">${ctxEsc(m.body || "")}</div>`;
  const mine = m.author === me.id;
  const clusterPosition = cluster.startsCluster && cluster.endsCluster ? "single" : cluster.startsCluster ? "start" : cluster.endsCluster ? "end" : "middle";
  const reply = m.replyTo ? c.messages.find(x => x.id === m.replyTo) : null;
  const reacts = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length).map(([e, ids]) => c.legacyArchive
    ? `<span class="reaction-chip ${ids.includes(me.id) ? "mine" : ""}" aria-label="${ctxEsc(e)}, ${ids.length} ${ids.length === 1 ? "reaction" : "reactions"}">${ctxEsc(e)}<span>${ids.length}</span></span>`
    : `<button type="button" class="reaction-chip ${ids.includes(me.id) ? "mine" : ""}" data-react-msg="${ctxEsc(m.id)}" data-react-emoji="${ctxEsc(e)}" aria-label="React with ${ctxEsc(e)}, ${ids.length} ${ids.length === 1 ? "reaction" : "reactions"}">${ctxEsc(e)}<span>${ids.length}</span></button>`).join("");
  const saved = messageIsSaved(m, me.id);
  const flags = [m.edited ? "edited" : "", m.forwarded ? "Forwarded" : "", saved ? "Saved" : "", (c.pinnedIds || []).includes(m.id) ? "Pinned" : ""].filter(Boolean).join(" · ");
  const status = cluster.endsCluster ? receiptText(m, me) : "";
  const time = cluster.endsCluster ? `<span class="message-time">${clock(m.created)}</span>` : "";
  const receipt = cluster.endsCluster && mine ? `<span class="message-status">${status}</span>` : "";
  const footer = `${time}${receipt}`;
  const metadata = flags || footer ? `<div class="meta-line"><span class="message-flags">${flags}</span>${footer ? `<span class="message-footer">${footer}</span>` : ""}</div>` : "";
  const messageRow = `class="message-row ${mine ? "mine" : "theirs"} cluster-${clusterPosition}"`;
  const messageOptions = c.legacyArchive ? `aria-label="Archived message"` : `data-msg="${ctxEsc(m.id)}" role="button" tabindex="0" aria-label="Message options"`;
  return `<div ${messageRow}><div class="bubble-msg ${mine ? "mine" : "theirs"} cluster-${clusterPosition}" ${messageOptions}>${c.group && !mine ? `<div class="sub">${ctxEsc(api.user(m.author)?.name || "")}</div>` : ""}${reply ? `<div class="quote">${ctxEsc(preview(reply))}</div>` : ""}<div class="message-body">${body(m, c.legacyArchive)}</div>${reacts ? `<div class="reacts">${reacts}</div>` : ""}${!c.legacyArchive && m.status === "failed" ? `<button type="button" class="sub message-retry" data-retry="${m.id}" aria-label="Retry sending message">Not sent · Retry</button>` : ""}</div>${metadata}</div>`;
}
function body(m, readOnly = false) {
  const text = String(m.body || "").replace(/\r\n?/g, "\n").trim();
  if (m.expired) return "This photo has expired.";
  if (m.kind === "shared-post") return renderSharedMessage(m, ctxEsc);
  if (m.kind === "photo" || m.kind === "gif") return m.viewOnce ? "Photo · View once" : m.media ? `<img class="message-media" ${mediaSource(m)} alt="${ctxEsc(m.caption || "Shared photo")}" />${m.caption ? `<div>${ctxEsc(m.caption)}</div>` : ""}` : "Photo unavailable";
  if (m.kind === "video") return m.media ? `<video class="message-media" ${mediaSource(m)} controls playsinline preload="none"></video>` : "Video unavailable";
  if (m.kind === "voice") return voiceBody(m);
  if (m.kind === "file") return m.media ? `<a class="message-file" ${mediaSource(m, "href")} download="${ctxEsc(m.fileName || "download")}">${ctxEsc(m.fileName || "File")}</a> · ${ctxEsc(m.fileSize || "")}` : "File unavailable";
  if (m.kind === "sticker") return `<div class="emoji" style="font-size:48px">${ctxEsc(m.body || "")}</div>`;
  if (m.kind === "location") return "Location · " + ctxEsc(m.body || "Shared place");
  if (m.kind === "contact") return "Contact · " + ctxEsc(m.body || "");
  if (m.kind === "call") return ctxEsc(text || "Call");
  if (m.kind === "poll") return poll(m, readOnly);
  const linked = ctxEsc(text).replace(/(https?:\/\/[^\s]+)/g, '<span class="sub">$1</span>') + tournamentLinkMarkup(text, ctxEsc);
  return linked.replace(/\*([^*]+)\*/g, "<b>$1</b>").replace(/_([^_]+)_/g, "<i>$1</i>").replace(/~([^~]+)~/g, "<s>$1</s>");
}
function mediaSource(message, attribute = "src") {
  const reference = String(message.media || "");
  if (reference.startsWith("oldtime-media:")) {
    return `data-local-media="${ctxEsc(reference)}" data-local-media-owner="${ctxEsc(message.cloudMediaOwnerId || message.author || "")}"`;
  }
  return `${attribute}="${ctxEsc(reference)}"`;
}
function poll(m, readOnly = false) {
  const p = m.poll || { question: m.body, options: [], votes: {} };
  return `<b>${ctxEsc(p.question)}</b>` + (p.options || []).map((o, i) => readOnly
    ? `<div class="pollopt">${ctxEsc(o)} · ${(p.votes?.[i] || []).length}</div>`
    : `<button class="pollopt" data-vote="${m.id}:${i}">${ctxEsc(o)} · ${(p.votes?.[i] || []).length}</button>`).join("");
}
function onMessage(ctx, cid, id) {
  const c = convo(cid);
  const m = c.messages.find(x => x.id === id);
  if (!m) return;
  if (m.viewOnce && !m.viewed && m.author !== api.me().id && m.media) {
    const media = m.media;
    mutate(db => { const msg = db.convos.find(x => x.id === cid).messages.find(x => x.id === id); msg.viewed = true; msg.expired = true; delete msg.media; });
    const sheet = ctx.$("#sheet");
    sheet.classList.add("on");
    sheet.innerHTML = `<div class="panel"><b>View once</b><img class="message-media" src="${ctxEsc(media)}" alt="View once photo" /><button class="btn" id="close-once">Close</button></div>`;
    ctx.$("#close-once").onclick = () => ctx.render();
    sheet.onclick = e => { if (e.target === sheet) ctx.render(); };
    return;
  }
  const mine = m.author === api.me().id;
  const actions = ["Reply", "React", "Forward", "Copy", "Keep", ...(m.viewOnce || m.expired ? [] : [messageIsSaved(m, api.me().id) ? "Unsave" : "Save"]), "Pin", "Delete"];
  if (mine && m.kind === "text") actions.splice(5, 0, "Edit");
  if (mine) actions.push("Delete for everyone");
  const messageDetails = [messageDateTime(m.created), m.edited ? "Edited" : ""].filter(Boolean).join(" · ");
  menu(ctx, actions, (label) => {
    if (label === "Reply") ui.reply = id;
    if (label === "React") {
      const target = document.createElement("input");
      return openEmojiPicker(target, emoji => { react(cid, id, emoji); ctx.render(); }, { chat: true, selectOnly: true });
    }
    if (label === "Forward") return forward(ctx, cid, id);
    if (label === "Copy") { navigator.clipboard?.writeText(m.body || preview(m)).then(() => ctx.toast("Copied")).catch(() => ctx.toast("Couldn't copy")); if (!navigator.clipboard) ctx.toast("Clipboard unavailable"); }
      if (label === "Keep") mutate(db => { const msg = db.convos.find(x => x.id === cid).messages.find(x => x.id === id); msg.kept = true; delete msg.expiresAt; db.kept = db.kept || []; db.kept.push({ id, chat: cid, body: (msg.body || "").slice(0, 280), kind: msg.kind, at: Date.now() }); });
    if (label === "Save" || label === "Unsave") {
        try { mutate(db => toggleMessageSaved(db, cid, id, api.me().id)); void syncCloudChatState(cid, ctx); ctx.toast(label === "Save" ? "Message saved" : "Removed from Saved"); }
      catch (error) { return ctx.toast(error.message); }
    }
      if (label === "Pin") mutate(db => { const cv = db.convos.find(x => x.id === cid); cv.pinnedIds = cv.pinnedIds.includes(id) ? cv.pinnedIds.filter(x => x !== id) : [id, ...cv.pinnedIds].slice(0, 3); });
      if (label === "Edit") {
        const next = prompt("Edit message", m.body)?.trim();
        if (next) {
          if (api.authMode() === "cloud" && m.cloudSynced) {
            void api.editCloudChatMessage(cid, id, next).then(() => {
              mutate(db => { const msg = db.convos.find(x => x.id === cid).messages.find(x => x.id === id); msg.editHistory.push(msg.body); msg.body = next; msg.edited = true; });
              ctx.render();
            }).catch(error => ctx.toast(error.message || "Message could not be edited."));
            return;
          }
          mutate(db => { const msg = db.convos.find(x => x.id === cid).messages.find(x => x.id === id); msg.editHistory.push(msg.body); msg.body = next; msg.edited = true; });
        }
      }
    if (label === "Delete") mutate(db => { const msg = db.convos.find(x => x.id === cid).messages.find(x => x.id === id); msg.hiddenFor = [...new Set([...(msg.hiddenFor || []), api.me().id])]; });
      if (label === "Delete for everyone" && mine) {
        if (api.authMode() === "cloud" && m.cloudSynced) {
          void api.deleteCloudChatMessage(cid, id).then(() => {
            mutate(db => { const cv = db.convos.find(x => x.id === cid); cv.messages = cv.messages.filter(x => x.id !== id); });
            void syncCloudChatState(cid, ctx);
            ctx.render();
          }).catch(error => ctx.toast(error.message || "Message could not be deleted."));
          return;
        }
        mutate(db => { const cv = db.convos.find(x => x.id === cid); cv.messages = cv.messages.filter(x => x.id !== id); });
      }
      if (["Keep", "Pin", "Delete"].includes(label)) void syncCloudChatState(cid, ctx);
    ctx.render();
  }, messageDetails);
}
function react(cid, id, emoji, ctx) {
  mutate(db => {
    const m = db.convos.find(x => x.id === cid).messages.find(x => x.id === id);
    m.reactions[emoji] = m.reactions[emoji] || [];
    const i = m.reactions[emoji].indexOf(api.me().id);
    if (i >= 0) m.reactions[emoji].splice(i, 1); else m.reactions[emoji].push(api.me().id);
  });
  void syncCloudChatState(cid, ctx);
}
function vote(cid, id, i, ctx) {
  mutate(db => {
    const m = db.convos.find(x => x.id === cid).messages.find(x => x.id === id);
    m.poll.votes = m.poll.votes || {};
    Object.keys(m.poll.votes).forEach(k => { m.poll.votes[k] = m.poll.votes[k].filter(u => u !== api.me().id); });
    m.poll.votes[i] = m.poll.votes[i] || [];
    m.poll.votes[i].push(api.me().id);
  });
  void syncCloudChatState(cid, ctx);
}
function forward(ctx, cid, id) {
  const src = convo(cid).messages.find(m => m.id === id);
  if (src.viewOnce || src.expired) return ctx.toast("View-once media cannot be forwarded");
  const targets = api.db().convos.filter(c => c.members.includes(api.me().id) && c.id !== cid && !c.members.some(uid => api.blocked(api.me().id, uid)));
  if (!targets.length) return ctx.toast("Start another chat to forward a message");
  menu(ctx, targets.map((c, i) => `${i + 1}. ${nameOf(c, api.me())}`), (name) => {
    const to = targets[Number(name.split(".")[0]) - 1];
    const src = convo(cid).messages.find(m => m.id === id);
    const copy = structuredClone(src);
    ["id", "replyTo", "expiresAt", "starred", "viewed", "expired", "hiddenFor"].forEach(key => delete copy[key]);
    pushMsg(to.id, { ...copy, forwarded: true, author: api.me().id, reactions: {}, editHistory: [], status: "sending" });
    ctx.toast("Forwarded");
  });
}
function attach(ctx, id) {
  menu(ctx, ["Media", "Document", "GIF", "Sticker", "Location", "Contact", "Poll", "View once"], (label) => {
    const me = api.me();
    if (["Media", "Document", "GIF", "View once"].includes(label)) {
      const input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      input.accept = label === "Media" ? "image/*,video/*" : label === "Document" ? ".pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rtf" : label === "GIF" ? "image/gif" : "image/*";
      ctx.app.appendChild(input);
      input.oncancel = () => input.remove();
      input.onchange = async () => {
        try {
          const file = input.files[0];
          if (!file) return;
          if (label === "Media" && !file.type.startsWith("video/") && !file.type.startsWith("image/")) return ctx.toast("Choose a photo or video");
          if (label === "View once" && !file.type.startsWith("image/")) return ctx.toast("Choose an image");
          if (label === "GIF" && file.type !== "image/gif") return ctx.toast("Choose a GIF file");
          const { putLocalMedia } = await import("./local-media.js");
          let lastProgress = -10;
          let uploadedSize = file.size;
          const media = await putLocalMedia(file, undefined, (fraction, phase, details) => {
            if (Number.isSafeInteger(details?.size)) uploadedSize = details.size;
            const percent = Math.round(fraction * 100);
            if (percent === 100 || percent - lastProgress >= 10) {
              lastProgress = percent;
              ctx.toast(`${phase === "compressing" ? "Optimizing video" : "Uploading attachment"} · ${percent}%`);
            }
          });
          const kind = label === "Document" ? "file" : label === "GIF" ? "gif" : file.type.startsWith("video/") ? "video" : "photo";
          pushMsg(id, { kind, media, body: file.name, fileName: file.name, fileSize: `${Math.ceil(uploadedSize / 1024)} KB`, viewOnce: label === "View once" });
          ctx.render();
        } catch (e) { ctx.toast(e.message || "Couldn't attach file"); }
        finally { input.remove(); }
      };
      input.click();
      return;
    }
    if (label === "Sticker") {
      const target = document.createElement("input");
      return openEmojiPicker(target, emoji => { pushMsg(id, { kind: "sticker", body: emoji }); ctx.render(); }, { chat: true, selectOnly: true, mode: "stickers" });
    }
    if (label === "Location") {
      const place = prompt("Share a place (not your live location)", me.city || "");
      if (place?.trim()) pushMsg(id, { kind: "location", body: place.trim() });
      return ctx.render();
    }
    if (label === "Contact") {
      const users = api.db().users.filter(u => !api.blocked(me.id, u.id));
      return menu(ctx, users.map(u => `${u.name} (@${u.username})`), name => {
        const user = users.find(u => `${u.name} (@${u.username})` === name);
        pushMsg(id, { kind: "contact", body: `${user.name} @${user.username}` }); ctx.render();
      });
    }
    if (label === "Poll") {
      const sheet = ctx.$("#sheet");
      sheet.classList.add("on");
      sheet.innerHTML = `<div class="panel"><b>Create poll</b><input class="field" id="poll-question" placeholder="Question" /><textarea class="field" id="poll-options" placeholder="Options, one per line"></textarea><button class="btn" id="poll-send">Send poll</button></div>`;
      ctx.$("#poll-send").onclick = () => {
        const question = ctx.$("#poll-question").value.trim();
        const options = [...new Set(ctx.$("#poll-options").value.split("\n").map(o => o.trim()).filter(Boolean))];
        if (!question || options.length < 2 || options.length > 10) return ctx.toast("Add a question and 2–10 different options");
        pushMsg(id, { kind: "poll", body: question, poll: { question, options, votes: {} } }); ctx.render();
      };
      sheet.onclick = e => { if (e.target === sheet) sheet.classList.remove("on"); };
    }
  });
}
function info(ctx, id) {
  const c = convo(id);
  const me = api.me();
  if (!c.group) return contactInfo(ctx, id, c, me);
  const members = c.members.map(uid => api.user(uid)).filter(Boolean);
  ctx.shell(`<section class="screen on light chat-details-screen"><div class="scroll details-scroll">
    <div class="details-topbar"><button id="back" class="detail-back" aria-label="Back to conversation">${ic.back}</button><span>Chat details</span><button id="group-options" class="detail-back" aria-label="More group options">${ic.more}</button></div>
    <header class="details-hero">
      <div class="group-avatar-stack">${members.slice(0, 3).map((u, i) => `<img class="stack-${i}" src="${ctxEsc(u.avatar)}" alt="" />`).join("")}</div>
      <h1>${ctxEsc(nameOf(c, me))}</h1><p>${members.length} people · Group conversation</p>
      <div class="details-shortcuts">
        <button class="shortcut" id="group-search">${ic.search}<span>Search</span></button>
        <button class="shortcut" id="group-mute">${ic.bell}<span>Mute</span></button>
        <button class="shortcut" id="group-options-short">${ic.more}<span>Options</span></button>
      </div>
    </header>
    <section class="details-section">
      <div class="section-heading"><b>Shared media</b><button id="media" class="section-link">See all ${ic.back}</button></div>
      ${sharedPreview(c)}
    </section>
    <section class="details-section details-options">
      <h2>Conversation</h2>
      <button class="detail-row" id="dis"><span class="row-icon">${ic.lock}</span><span><b>Disappearing messages</b><small>${ctxEsc(c.disappear)}</small></span>${ic.back}</button>
      <button class="detail-row" id="hide"><span class="row-icon">${ic.lock}</span><span><b>Hide chat</b><small>Move this conversation to hidden chats</small></span>${ic.back}</button>
      <button class="detail-row" id="group"><span class="row-icon">${ic.user}</span><span><b>Group settings</b><small>Members, name and permissions</small></span>${ic.back}</button>
    </section>
    <section class="details-section safety-section">
      <h2>Safety</h2>
      <button class="detail-row danger-row" id="report"><span class="row-icon">${ic.bell}</span><span><b>Report group</b><small>Tell us about a concern</small></span>${ic.back}</button>
    </section>
  </div></section>`, "light", { hideNav: true });
  ctx.$("#back").onclick = () => { ui.screen = "thread"; ctx.render(); };
  ctx.$("#media").onclick = () => { ui.screen = "media"; ctx.render(); };
  ctx.$("#group-search").onclick = () => { ui.screen = "search"; ctx.render(); };
  ctx.$("#group-mute").onclick = () => mute(ctx, id);
  ctx.$("#group-options-short").onclick = () => groupOptions(ctx, id);
  ctx.$("#group-options").onclick = () => groupOptions(ctx, id);
  ctx.$("#dis").onclick = () => disappear(ctx, id);
  ctx.$("#hide").onclick = () => {
    mutate(db => { const chat = db.convos.find(x => x.id === id); chat.locked = true; });
    void syncCloudChatState(id, ctx);
    ui.screen = "list";
    ctx.setChat(null);
    ctx.toast("Chat hidden");
  };
  ctx.$("#group").onclick = () => { ui.screen = "group"; ctx.render(); };
  ctx.$("#report").onclick = () => { mutate(db => db.reports.push({ id: "r" + Date.now(), by: me.id, target: id, reason: "chat", at: Date.now() })); ctx.toast("Report saved. Moderation unavailable."); };
  bindShared(ctx);
}
function contactInfo(ctx, id, c, me) {
  const other = api.user(c.members.find(x => x !== me.id));
  if (!other) { ui.screen = "thread"; return ctx.render(); }
  const requested = (api.db().requests || []).some(r => r.from === me.id && r.to === other.id);
  const following = (me.following || []).includes(other.id);
  const followersCount = relationshipCount(other.followers);
  const followingCount = relationshipCount(other.following);
  const followLabel = following ? "Following" : requested ? "Requested" : "Follow";
  ctx.shell(`<section class="screen on light chat-details-screen"><div class="scroll details-scroll">
    <div class="details-topbar"><button id="back" class="detail-back" aria-label="Back to conversation">${ic.back}</button><span>Chat details</span><button id="contact-more" class="detail-back" aria-label="More contact options">${ic.more}</button></div>
    <header class="details-hero contact-details-hero">
      <img class="details-avatar" src="${ctxEsc(other.avatar)}" alt="${ctxEsc(other.name)}" />
      <h1>${ctxEsc(other.name)} ${other.verified ? `<span class="verified" aria-label="Verified">${ic.check}</span>` : ""}</h1>
      <p class="detail-handle">@${ctxEsc(other.username)}</p>
      <p class="contact-stats">${followersCount} followers · ${followingCount} following</p>
      <p class="contact-presence">On Oldtime</p>
        <div class="contact-follow-row"><button type="button" id="contact-follow" class="contact-follow ${following ? "following" : ""}" data-testid="button-chat-follow" aria-pressed="${following}">${followLabel}</button></div>
      <div class="details-shortcuts">
        <button class="shortcut" id="profile-shortcut">${ic.user}<span>Profile</span></button>
        <button class="shortcut" id="search-shortcut">${ic.search}<span>Search</span></button>
        <button class="shortcut" id="mute-shortcut">${ic.bell}<span>${c.mutedUntil > Date.now() ? "Unmute" : "Mute"}</span></button>
        <button class="shortcut" id="options-shortcut">${ic.more}<span>Options</span></button>
      </div>
    </header>
    <section class="details-section">
      <div class="section-heading"><b>Shared media</b><button id="media" class="section-link">See all ${ic.back}</button></div>
      ${sharedPreview(c)}
    </section>
    <section class="details-section details-options">
      <h2>Conversation</h2>
      <button class="detail-row" id="details-dis"><span class="row-icon">${ic.lock}</span><span><b>Disappearing messages</b><small>${ctxEsc(c.disappear)}</small></span>${ic.back}</button>
      <button class="detail-row" id="details-hide"><span class="row-icon">${ic.lock}</span><span><b>Hide chat</b><small>Move this conversation to hidden chats</small></span>${ic.back}</button>
    </section>
    <section class="details-section safety-section">
      <h2>Safety</h2>
      <button class="detail-row danger-row" id="block"><span class="row-icon">${ic.lock}</span><span><b>Block @${ctxEsc(other.username)}</b><small>They won't be able to message or find you</small></span>${ic.back}</button>
      <button class="detail-row danger-row" id="report"><span class="row-icon">${ic.bell}</span><span><b>Report</b><small>Tell us about a concern</small></span>${ic.back}</button>
    </section>
  </div></section>`, "light", { hideNav: true });
  ctx.$("#back").onclick = () => { ui.screen = "thread"; ctx.render(); };
  ctx.$("#media").onclick = () => { ui.screen = "media"; ctx.render(); };
  const openSearch = () => { ui.screen = "search"; ctx.render(); };
  const openOptions = () => contactOptions(ctx, id, other, me);
  ctx.$("#search-shortcut").onclick = openSearch;
  ctx.$("#mute-shortcut").onclick = () => mute(ctx, id);
  ctx.$("#options-shortcut").onclick = openOptions;
  ctx.$("#contact-more").onclick = openOptions;
  ctx.$("#profile-shortcut").onclick = () => {
    if (ctx.openProfile) {
      ui.screen = "thread";
      ctx.openProfile(other.id);
    }
    else ctx.toast("Profile unavailable");
  };
  ctx.$("#details-dis").onclick = () => disappear(ctx, id);
  ctx.$("#details-hide").onclick = () => {
    mutate(db => { const chat = db.convos.find(x => x.id === id); chat.locked = true; });
    void syncCloudChatState(id, ctx);
    ui.screen = "list";
    ctx.setChat(null);
    ctx.toast("Chat hidden");
  };
  ctx.$("#block").onclick = () => blockContact(ctx, id, other, me);
  ctx.$("#report").onclick = () => reportContact(ctx, other, me);
  bindShared(ctx);
  ctx.$("#contact-follow").onclick = () => toggleContactFollow(ctx, other, me);
}
function sharedPreview(c) {
  const items = c.messages.filter(m => !m.hiddenFor?.includes(api.me().id) && !m.viewOnce && !m.expired && ["photo", "video", "file", "voice", "gif"].includes(m.kind)).slice(-3).reverse();
  if (!items.length) return `<div class="shared-empty"><span>${ic.image}</span><b>No shared media yet</b></div>`;
  return `<div class="shared-preview">${items.map(m => `<button class="shared-item" data-shared="${m.id}" aria-label="Open shared ${ctxEsc(m.kind)}"><span class="shared-thumb">${m.media && ["photo","gif","video"].includes(m.kind) ? (m.kind === "video" ? `<video src="${ctxEsc(m.media)}" muted preload="none"></video>` : `<img src="${ctxEsc(m.media)}" loading="lazy" decoding="async" alt="" />`) : m.kind === "file" ? ic.edit : ic.mic}</span><span>${ctxEsc(m.kind === "file" ? m.fileName || "File" : m.kind[0].toUpperCase() + m.kind.slice(1))}</span></button>`).join("")}</div>`;
}
function bindShared(ctx) {
  ctx.app.querySelectorAll("[data-shared]").forEach(b => b.onclick = () => { ui.screen = "media"; ctx.render(); });
}
function relationshipCount(value) {
  if (Array.isArray(value)) return value.length;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}
async function toggleContactFollow(ctx, other, me) {
  if (api.blocked(me.id, other.id)) return ctx.toast("Unblock this user before following");
  const wasFollowing = (me.following || []).includes(other.id);

  if (api.authMode() === "cloud") {
    try {
      await api.refreshCloudRelationships();
      const current = api.me();
      const isFollowing = (current?.following || []).includes(other.id);
      const hasRequest = (api.db().requests || []).some(request => request.from === current?.id && request.to === other.id);
      await api.setCloudFollow(other.id, !isFollowing && !hasRequest);
      const updated = api.me();
      const nowFollowing = (updated?.following || []).includes(other.id);
      const nowRequested = (api.db().requests || []).some(request => request.from === updated?.id && request.to === other.id);
      ctx.render();
      ctx.toast(nowFollowing ? "Following" : nowRequested ? "Follow request sent" : isFollowing ? "Unfollowed" : "Follow request canceled");
    } catch (error) {
      ctx.toast(error.message || "Follow settings could not be updated.");
    }
    return;
  }

  const state = api.db();
  const currentProfile = state.users.find(user => user.id === me.id);
  const targetProfile = state.users.find(user => user.id === other.id);
  if (!currentProfile || !targetProfile) return ctx.toast("This account is unavailable. Try again from its profile.");

  const isFollowing = (currentProfile.following || []).includes(targetProfile.id);
  const hasRequest = (state.requests || []).some(request => request.from === currentProfile.id && request.to === targetProfile.id);
  mutate(db => {
    const current = db.users.find(user => user.id === currentProfile.id);
    const target = db.users.find(user => user.id === targetProfile.id);
    if (!current || !target) return;
    current.following = Array.isArray(current.following) ? current.following : [];
    target.followers = Array.isArray(target.followers) ? target.followers : [];
    if (isFollowing) {
      current.following = current.following.filter(userId => userId !== target.id);
      target.followers = target.followers.filter(userId => userId !== current.id);
      db.requests = (db.requests || []).filter(request => !(request.from === current.id && request.to === target.id));
    } else if (target.private) {
      if (hasRequest) db.requests = (db.requests || []).filter(request => !(request.from === current.id && request.to === target.id));
      else (db.requests || (db.requests = [])).push({ from: current.id, to: target.id, at: Date.now() });
    } else {
      if (!current.following.includes(target.id)) current.following.push(target.id);
      if (!target.followers.includes(current.id)) target.followers.push(current.id);
      notify(db, { id: "n" + Date.now(), user: target.id, kind: "follow", actor: current.id, body: "started following you", created: Date.now(), read: false });
    }
  });
  ctx.render();
  const nowFollowing = (api.me()?.following || []).includes(other.id);
  const nowRequested = (api.db().requests || []).some(request => request.from === me.id && request.to === other.id);
  ctx.toast(nowFollowing ? "Following" : nowRequested ? "Requested" : wasFollowing ? "Unfollowed" : "Follow request canceled");
}
async function blockContact(ctx, other, me) {
  if (!confirm(`Block ${other.name}?`)) return;
  if (api.authMode() === "cloud") {
    try {
      await api.refreshCloudBlocks();
      const selected = new Set(api.cloudBlocks());
      selected.add(other.id);
      await api.replaceCloudBlocks([...selected]);
    } catch (error) {
      ctx.toast(error.message || "Block settings could not be updated.");
      return;
    }
  } else {
    mutate(db => {
      if (!db.blocks.some(block => block.by === me.id && block.who === other.id)) {
        db.blocks.push({ by: me.id, who: other.id });
      }
    });
  }
  ui.screen = "list";
  ctx.setChat(null);
  ctx.render();
  ctx.toast("Blocked");
}
function reportContact(ctx, other, me) {
  menu(ctx, ["Spam", "Harassment", "Inappropriate content", "Something else"], category => {
    const reasons = {
      Spam: "This profile is sending spam or unwanted messages.",
      Harassment: "This profile is harassing or bullying me.",
      "Inappropriate content": "This profile contains inappropriate content.",
      "Something else": "Please review this profile for a safety concern.",
    };
    const reason = reasons[category];
    if (api.authMode() === "cloud") {
      const targetUserId = api.user(other.id)?.cloudAccountId || other.cloudAccountId || other.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetUserId)) {
        return ctx.toast("This profile is not linked to online reporting.");
      }
      void api.submitCloudReport({ kind: "profile", category, targetUserId, reason })
        .then(() => ctx.toast("Report received by Oldtime. Review status is not available yet."))
        .catch(error => ctx.toast(error.message || "Couldn’t submit this report."));
      return;
    }
    mutate(db => db.reports.push({ id: "r" + Date.now(), by: me.id, target: other.id, reason, at: Date.now() }));
    ctx.toast("Report saved");
  });
}
function contactOptions(ctx, id, other, me) {
  menu(ctx, ["Shared media", "Search", "Mute", "Disappearing messages", "Hide chat", "Block", "Report"], label => {
    if (label === "Shared media") { ui.screen = "media"; return ctx.render(); }
    if (label === "Search") { ui.screen = "search"; return ctx.render(); }
    if (label === "Mute") return mute(ctx, id);
    if (label === "Disappearing messages") return disappear(ctx, id);
    if (label === "Hide chat") {
      mutate(db => { const chat = db.convos.find(x => x.id === id); chat.locked = true; });
      void syncCloudChatState(id, ctx);
      ui.screen = "list";
      ctx.setChat(null);
      ctx.toast("Chat hidden");
      return;
    }
    if (label === "Block") return blockContact(ctx, other, me);
    reportContact(ctx, other, me);
  });
}
function groupOptions(ctx, id) {
  menu(ctx, ["Shared media", "Search", "Mute", "Disappearing messages", "Hide chat", "Group settings", "Report"], label => {
    if (label === "Shared media") { ui.screen = "media"; return ctx.render(); }
    if (label === "Search") { ui.screen = "search"; return ctx.render(); }
    if (label === "Mute") return mute(ctx, id);
    if (label === "Disappearing messages") return disappear(ctx, id);
    if (label === "Hide chat") {
      mutate(db => { const chat = db.convos.find(x => x.id === id); chat.locked = true; });
      void syncCloudChatState(id, ctx);
      ui.screen = "list";
      ctx.setChat(null);
      ctx.toast("Chat hidden");
      return;
    }
    if (label === "Group settings") { ui.screen = "group"; return ctx.render(); }
    mutate(db => db.reports.push({ id: "r" + Date.now(), by: api.me().id, target: id, reason: "chat", at: Date.now() }));
     ctx.toast("Report saved. Moderation unavailable.");
  });
}
function search(ctx, id) {
  const c = convo(id);
  const q = (ui.q || "").toLowerCase();
  const hits = c.messages.filter(m => !m.hiddenFor?.includes(api.me().id) && (!q || preview(m).toLowerCase().includes(q) || (m.body || "").toLowerCase().includes(q)));
  ctx.shell(`<section class="screen on light" style="background:#fff;color:#111"><div class="scroll page">
    <div class="topbar"><button id="back">←</button><b>Search</b><span></span></div>
    <input class="chatsearch" id="sq" placeholder="Search this chat" value="${ctxEsc(ui.q)}" />
    ${hits.map(m => `<button class="listbtn" data-jump="${m.id}">${ctxEsc(preview(m))}</button>`).join("")}
  </div></section>`, "light");
  ctx.$("#back").onclick = () => { ui.screen = "thread"; ctx.render(); };
  ctx.$("#sq").oninput = (e) => { const position = e.target.selectionStart; ui.q = e.target.value; ctx.render(); ctx.$("#sq").focus(); ctx.$("#sq").setSelectionRange(position, position); };
  ctx.app.querySelectorAll("[data-jump]").forEach(b => b.onclick = () => { ui.screen = "thread"; ctx.render(); setTimeout(() => jump(b.dataset.jump), 30); });
}
function media(ctx, id) {
  const c = convo(id);
  const items = c.messages.filter(m => !m.hiddenFor?.includes(api.me().id) && !m.viewOnce && !m.expired && ["photo", "video", "file", "voice", "gif"].includes(m.kind));
  ctx.shell(`<section class="screen on light" style="background:#fff;color:#111"><div class="scroll page">
    <div class="topbar"><button id="back">←</button><b>Media</b><span></span></div>
    <div class="sub">Photos ${items.filter(m => m.kind === "photo").length} · Videos ${items.filter(m => m.kind === "video").length} · Files ${items.filter(m => m.kind === "file").length} · Voice ${items.filter(m => m.kind === "voice").length}</div>
    ${items.map(m => `<div class="card">${body(m)}</div>`).join("") || `<div class="empty">No media yet.</div>`}
  </div></section>`, "light");
  ctx.$("#back").onclick = () => { ui.screen = "thread"; ctx.render(); };
  bindVoice(ctx.app);
}
function group(ctx, id) {
  const c = convo(id);
  const g = c.group;
  ctx.shell(`<section class="screen on light" style="background:#fff;color:#111"><div class="scroll page">
    <div class="topbar"><button id="back">←</button><b>Group</b><span></span></div>
    <input class="field" id="gname" value="${ctxEsc(g.name)}" />
    ${c.members.map(uid => `<div class="listbtn">${ctxEsc(api.user(uid)?.name || uid)} ${g.admins.includes(uid) ? "· Admin" : ""}</div>`).join("")}
    <button class="btn" id="gsave" style="margin-top:8px">Save</button>
    <button class="listbtn" id="from">New group from these people</button>
  </div></section>`, "light");
  ctx.$("#back").onclick = () => { ui.screen = "info"; ctx.render(); };
  ctx.$("#gsave").onclick = () => { if (!g.admins.includes(api.me().id)) return ctx.toast("Only group admins can change the name"); const name = ctx.$("#gname").value.trim(); if (!name) return ctx.toast("Enter a group name"); mutate(db => { db.convos.find(x => x.id === id).group.name = name; }); ctx.toast("Saved"); };
  ctx.$("#from").onclick = () => { const title = prompt("Group name", "New group"); if (!title) return; const c2 = blankConvo(c.members.slice(0, 8), title); c2.group = groupMeta(title, api.me().id); mutate(db => db.convos.unshift(c2)); ui.screen = "thread"; ctx.setChat(c2.id); };
}
function saved(ctx) {
  const me = api.me(), items = [];
  api.db().convos.filter(c => c.members.includes(me.id) && !c.locked && !c.members.some(uid => api.blocked(me.id, uid))).forEach(c => c.messages.forEach(m => { if (!m.hiddenFor?.includes(me.id) && (messageIsSaved(m, me.id) || m.kept) && !(m.expiresAt <= Date.now())) items.push([c, m]); }));
  ctx.shell(`<section class="screen on light" style="background:#fff;color:#111"><div class="scroll page">
    <div class="topbar"><button id="back" aria-label="Back to messages">←</button><b>Saved messages</b><span></span></div>
    ${items.map(([c, m]) => `<button class="listbtn" data-cv="${ctxEsc(c.id)}" data-cv-msg="${ctxEsc(m.id)}"><span class="chat-saved-ic">${ic.bookmarkOn}</span>${ctxEsc(nameOf(c, me))} · ${ctxEsc(preview(m))}</button>`).join("") || `<div class="empty">No saved messages yet. Save a message from a chat to find it here.</div>`}
  </div></section>`, "light");
  ctx.$("#back").onclick = () => ctx.render();
  bindRows(ctx);
}
function pick(ctx, group, { initialId = "", initialQuery = "" } = {}) {
  const sheet = ctx.$("#sheet");
  const me = api.me();
  const isOnlinePerson = person => {
    const accountId = String(person?.cloudAccountId || "");
    return !!person && person.id !== me?.id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId) &&
      !api.blocked(me.id, person.id);
  };
  const picked = new Set(isOnlinePerson(api.user(initialId)) ? [initialId] : []);
  let query = String(initialQuery || "").slice(0, 80);
  let onlinePeople = [];
  let searchVersion = 0;
  let searchTimer = null;
  let searchStatus = "";
  let title = "";
  group = !!group;
  sheet.classList.add("on");
  const draw = () => {
    sheet.innerHTML = `<div class="panel chat-compose-panel"><div class="grab"></div><b>${group ? "New group" : "New message"}</b>
      <div class="chat-compose-modes" role="group" aria-label="Conversation type">
        <button type="button" class="chat-compose-mode" data-compose-kind="message" aria-pressed="${!group}">${ic.edit}<span>Message</span></button>
        <button type="button" class="chat-compose-mode" data-compose-kind="group" aria-pressed="${group}">${ic.users}<span>Group</span></button>
      </div>
      <label class="chat-compose-search">${ic.search}<input id="chat-contact-search" type="search" placeholder="Search online accounts" aria-label="Search online accounts" value="${ctxEsc(query)}" /></label>
      ${group ? `<input class="field" id="gtitle" placeholder="Group name" style="margin:8px 0" value="${ctxEsc(title)}" />` : ""}
      <p class="chat-compose-status" id="chat-contact-status" role="status"></p>
      ${group ? `<div class="chat-compose-selected" id="chat-compose-selected" aria-label="Selected group members"></div>` : ""}
      <div class="chat-compose-people" id="chat-contact-results"></div>
      ${group ? `<div id="chat-compose-action"></div>` : ""}</div>`;
    sheet.querySelectorAll("[data-compose-kind]").forEach(button => button.onclick = () => {
      const nextGroup = button.dataset.composeKind === "group";
      if (group !== nextGroup) picked.clear();
      group = nextGroup;
      draw();
      renderPeople();
    });
    if (group) ctx.$("#gtitle").oninput = (e) => { title = e.target.value; };
    const input = ctx.$("#chat-contact-search");
    input.oninput = () => {
      query = input.value;
      onlinePeople = [];
      const request = ++searchVersion;
      clearTimeout(searchTimer);
      if (query.trim().length < 2) {
        searchStatus = "Enter at least 2 characters to search online accounts.";
        renderPeople();
        return;
      }
      searchStatus = "Searching online accounts…";
      renderPeople();
      searchTimer = setTimeout(() => {
        void api.searchCloudUsers(query).then(profiles => {
          if (request !== searchVersion || !input.isConnected) return;
          onlinePeople = profiles.map(profile => api.user(profile.localId)).filter(isOnlinePerson);
          searchStatus = onlinePeople.length ? "" : "No online accounts found.";
          renderPeople();
        }).catch(error => {
          if (request !== searchVersion || !input.isConnected) return;
          searchStatus = error.message || "Online account search failed. Try again.";
          renderPeople();
        });
      }, 250);
    };
    const renderPeople = () => {
      const list = ctx.$("#chat-contact-results");
      if (!list) return;
      const selected = ctx.$("#chat-compose-selected");
      if (selected) {
        selected.innerHTML = [...picked].map(id => {
          const person = api.user(id);
          if (!person) return "";
          return `<span class="chat-compose-chip"><span>${ctxEsc(person.name || person.username)}</span><button type="button" data-remove-pick="${ctxEsc(id)}" aria-label="Remove ${ctxEsc(person.name || person.username)}">${ic.close}</button></span>`;
        }).join("");
        selected.hidden = !picked.size;
        selected.querySelectorAll("[data-remove-pick]").forEach(button => button.onclick = () => {
          picked.delete(button.dataset.removePick);
          renderPeople();
        });
      }
      const candidates = new Map();
      for (const person of [...api.db().users, api.user(initialId), ...onlinePeople]) {
        if (isOnlinePerson(person)) candidates.set(person.id, person);
      }
      const rows = [...candidates.values()]
        .filter(person => !query.trim() || onlinePeople.some(item => item.id === person.id) ||
          `${person.name || ""} ${person.username || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 20);
      list.innerHTML = rows.map(person => `<button type="button" class="listbtn chat-compose-person ${picked.has(person.id) ? "is-selected" : ""}" data-pick="${ctxEsc(person.id)}" aria-pressed="${picked.has(person.id)}">
        <img src="${ctxEsc(person.avatar || "")}" alt="" />
        <span><b>${ctxEsc(person.name || person.username)}</b><small>@${ctxEsc(person.username || "")}</small></span>
        <span class="chat-compose-person-state">${group ? (picked.has(person.id) ? "Remove" : "Add") : "Message"}</span>
      </button>`).join("") || `<div class="chat-compose-empty">${query.trim().length < 2 ? "Search by name or username to find people with an Oldtime account." : "No matching online accounts."}</div>`;
      list.querySelectorAll("[data-pick]").forEach(button => button.onclick = () => {
        const personId = button.dataset.pick;
        if (group) {
          picked.has(personId) ? picked.delete(personId) : picked.add(personId);
          renderPeople();
          return;
        }
        if (!isOnlinePerson(api.user(personId))) {
          ctx.toast("This account is no longer available.");
          return;
        }
        try {
          const conversationId = ensureConvo([personId]);
          sheet.classList.remove("on");
          ui.screen = "thread";
          ctx.setChat(conversationId);
        } catch (error) {
          ctx.toast(error.message || "Could not open this conversation.");
        }
      });
      const status = ctx.$("#chat-contact-status");
      if (status) status.textContent = searchStatus;
      const action = ctx.$("#chat-compose-action");
      if (action) {
        action.innerHTML = picked.size
          ? `<button type="button" class="chat-compose-start" id="start">${ic.users}<span>Create group</span></button>`
          : "";
        const start = ctx.$("#start");
        if (start) start.onclick = () => {
          if ([...picked].some(id => !isOnlinePerson(api.user(id)))) {
            return ctx.toast("Choose people with active Oldtime accounts.");
          }
          try {
            const conversation = blankConvo([api.me().id, ...picked], title.trim() || "Group");
            conversation.group = groupMeta(conversation.title, api.me().id);
            mutate(db => db.convos.unshift(conversation));
            sheet.classList.remove("on");
            ui.screen = "thread";
            ctx.setChat(conversation.id);
          } catch (error) {
            ctx.toast(error.message || "Could not create this group.");
          }
        };
      }
    };
    renderPeople();
  };
  draw();
  if (query.trim().length >= 2) {
    const input = ctx.$("#chat-contact-search");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove("on"); };
}
function menu(ctx, labels, onPick, detail = "") {
  const sheet = ctx.$("#sheet");
  sheet.classList.add("on");
  sheet.innerHTML = `<div class="panel"><div class="grab"></div>${detail ? `<div class="message-menu-detail">${ctxEsc(detail)}</div>` : ""}${labels.map(l => `<button class="listbtn" data-l="${ctxEsc(l)}">${ctxEsc(l)}</button>`).join("")}</div>`;
  sheet.querySelectorAll("[data-l]").forEach(b => b.onclick = () => { sheet.classList.remove("on"); onPick(b.dataset.l); });
  sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.remove("on"); };
}
function jump(id) { document.querySelector(`[data-msg="${id}"]`)?.scrollIntoView({ block: "center" }); }
