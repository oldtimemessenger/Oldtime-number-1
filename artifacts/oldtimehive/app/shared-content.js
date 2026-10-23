import { api, mutate, notify } from "./store.js";

export function findSharedComment(post, id) {
  if (!id) return null;
  for (const comment of post?.comments || []) {
    if (comment.id === id) return comment;
    const reply = comment.replies?.find(item => item.id === id);
    if (reply) return reply;
  }
  return null;
}

export function listRegularShareFriends(postId) {
  const me = api.me();
  const post = api.post(postId);
  if (!me || !post) return [];
  const ids = new Set([
    ...(me.friends || []),
    ...(me.following || []),
    ...(me.followers || []),
    ...api.db().convos
      .filter(chat => chat.members?.length === 2 && chat.members.includes(me.id))
      .map(chat => chat.members.find(id => id !== me.id))
      .filter(Boolean),
  ].map(String));
  return [...ids].map(id => api.user(id))
    .filter(person => person && person.id !== me.id && !api.blocked(me.id, person.id))
    .map(person => ({
      ...person,
      unavailable: !api.canSeePost(post, person.id),
      reason: "Cannot view this post",
    }));
}

export function sendPostToFriends(postId, recipientIds, { commentId = "", message = "" } = {}) {
  const me = api.me();
  const post = api.post(postId);
  if (!me || !post || !api.canSeePost(post)) throw new Error("Post unavailable.");
  if (commentId && !findSharedComment(post, commentId)) throw new Error("Comment unavailable.");
  const recipients = [...new Set(recipientIds.map(String))];
  if (!recipients.length) throw new Error("Choose at least one Friend.");
  const contacts = new Map(listRegularShareFriends(postId).map(person => [person.id, person]));
  if (recipients.some(id => id === me.id || !contacts.has(id) || api.blocked(me.id, id))) {
    throw new Error("Choose a Friend or an existing contact.");
  }
  if (recipients.some(id => contacts.get(id)?.unavailable || !api.canSeePost(post, id))) {
    throw new Error("One of these people cannot view this post.");
  }
  const body = String(message).trim();
  if (body.length > 500) throw new Error("Messages must be 500 characters or fewer.");
  if (api.authMode() === "cloud") {
    return sendCloudPostToFriends(post, recipients, { commentId, body, me });
  }
  const conversationIds = [];
  // Commit all recipients together: storage failure must not leave a partial send.
  mutate(db => {
    for (const recipient of recipients) {
      let chat = db.convos.find(c => c.members.length === 2 && c.members.includes(me.id) && c.members.includes(recipient));
      if (!chat) {
        chat = { id: "cv" + crypto.randomUUID(), members: [me.id, recipient], title: "", messages: [], draft: "", pinnedIds: [], disappear: "off", mutedUntil: 0, wallpaper: "", locked: false, group: null };
        db.convos.unshift(chat);
      }
      const created = Date.now();
      const duration = chat.disappear === "10 seconds" ? 10000 : chat.disappear === "24 hours" ? 86400000 : 0;
      chat.messages.push({
        id: "m" + crypto.randomUUID(), author: me.id, created, kind: "shared-post",
        sharedPostId: post.id, sharedCommentId: commentId || null, body,
        status: "sent", reactions: {}, editHistory: [], kept: false,
        ...(duration ? { expiresAt: created + duration } : {})
      });
      conversationIds.push(chat.id);
      notify(db, { id: "n" + crypto.randomUUID(), user: recipient, actor: me.id, kind: "message",
        body: commentId ? "shared a comment with you" : "shared a post with you", created, read: false });
    }
  });
  return conversationIds;
}

async function sendCloudPostToFriends(post, recipients, { commentId, body, me }) {
  await api.refreshCloudChats();
  const conversationIds = [];
  const failedRecipientIds = [];
  for (const recipient of recipients) {
    try {
      let chat = api.db().convos.find(item =>
        item.members.length === 2 && item.members.includes(me.id) && item.members.includes(recipient)
      );
      if (!chat) {
        chat = {
          id: crypto.randomUUID(), members: [me.id, recipient], title: "", messages: [], draft: "",
          pinnedIds: [], disappear: "off", mutedUntil: 0, wallpaper: "", locked: false, group: null,
        };
      }
      await api.ensureCloudChat(chat);
      const created = Date.now();
      const chatMode = chat.disappear || "off";
      const duration = chatMode === "10 seconds" ? 10000 : chatMode === "24 hours" ? 86400000 : 0;
      const message = {
        id: `m${crypto.randomUUID()}`,
        author: me.id,
        created,
        kind: "shared-post",
        sharedPostId: post.id,
        sharedCommentId: commentId || null,
        body,
        status: "sent",
        cloudSynced: true,
        reactions: {},
        editHistory: [],
        kept: false,
        ...(duration ? { expiresAt: created + duration } : {}),
      };
      await api.sendCloudChatMessage(chat.id, message);
      mutate(db => {
        let localChat = db.convos.find(item => item.id === chat.id);
        if (!localChat) {
          localChat = {
            ...chat, messages: [], draft: chat.draft || "", pinnedIds: chat.pinnedIds || [],
            disappear: chatMode, mutedUntil: chat.mutedUntil || 0, wallpaper: chat.wallpaper || "",
            cloudBacked: true,
          };
          db.convos.unshift(localChat);
        }
        localChat.messages ||= [];
        localChat.messages.push(message);
      });
      conversationIds.push(chat.id);
    } catch {
      failedRecipientIds.push(recipient);
    }
  }
  return { sentCount: conversationIds.length, conversationIds, failedRecipientIds };
}

function safeImage(value) {
  const url = String(value || "");
  return /^(https?:|blob:|data:image\/)/i.test(url) || (url && !url.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/i.test(url)) ? url : "";
}

export function renderSharedMessage(message, esc) {
  const post = api.post(message.sharedPostId);
  // Resolve live sources under the viewer's permissions; never cache private text/media.
  if (!post || !api.canSeePost(post)) return `<div class="shared-post-unavailable">Post unavailable</div>`;
  const comment = findSharedComment(post, message.sharedCommentId);
  if (message.sharedCommentId && !comment) return `<div class="shared-post-unavailable">Comment unavailable</div>`;
  const author = api.user(post.author);
  const image = safeImage(post.kind === "video" ? post.poster || author?.avatar : post.media?.[0]);
  const photo = safeImage(comment?.attachment?.url);
  return `<button type="button" class="message-shared-post" data-chat-shared-post="${esc(post.id)}" ${comment ? `data-chat-shared-comment="${esc(comment.id)}"` : ""} aria-label="Open shared ${comment ? "comment" : "post"}">
    ${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : ""}
    <span class="message-shared-author">@${esc(author?.username || "member")}</span>
    ${post.caption ? `<span class="message-shared-caption">${esc(post.caption)}</span>` : ""}
    ${comment ? `<span class="message-shared-comment"><b>@${esc(api.user(comment.author)?.username || "member")}</b><span>${esc(comment.body || "Photo comment")}</span>${photo ? `<img src="${esc(photo)}" alt="Shared comment photo">` : ""}</span>` : ""}
    <span class="message-shared-open">${comment ? "View comment" : "View post"}</span>
  </button>${message.body ? `<div>${esc(message.body)}</div>` : ""}`;
}
