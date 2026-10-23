// Story replies, views, and reactions use the cloud API. Tap bursts are visual-only animation.
import { icon } from "./icons.js";

export const MAX_BURSTS = 8, BURST_MS = 1000, MAX_COMMENT = 300;
export const QUICK_EMOJI = ["\u{1F602}", "\u{1F60D}", "\u{1F525}", "\u{1F44F}", "\u{1F62E}", "\u{1F64C}", "\u{1F499}", "\u{1F62D}"];
const IGNORE = "button,input,textarea,select,a,label,.row,.story-sheet,.story-live-chat,.story-insights,.story-bar,[data-ce-source],.creative-attribution,[contenteditable=true]";
export const isIgnoredTap = target => !target?.closest || !!target.closest(IGNORE);

export function createBurst({ host, create, max = MAX_BURSTS, ttl = BURST_MS, reduced = false, setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random }) {
  const live = new Map();
  const drop = node => { clearTimer(live.get(node)); live.delete(node); node.remove(); };
  return {
    spawn(x, y, glyph = "\u2665") {
      if (reduced) return null;
      while (live.size >= max) drop(live.keys().next().value);
      const node = create(); node.className = "story-burst"; node.textContent = glyph; node.setAttribute("aria-hidden", "true");
      node.style.left = `${Math.round(x)}px`; node.style.top = `${Math.round(y)}px`;
      node.style.setProperty("--drift", `${Math.round((random() - .5) * 60)}px`);
      host.append(node); live.set(node, setTimer(() => drop(node), ttl)); return node;
    },
    count: () => live.size,
    dispose() { for (const node of [...live.keys()]) drop(node); },
  };
}

export function validateStoryComment(text) {
  const body = String(text ?? "").trim();
  if (!body) throw new Error("Write a reply first.");
  if (body.length > MAX_COMMENT) throw new Error(`Replies can be up to ${MAX_COMMENT} characters.`);
  return body;
}

export function insertAtCursor(value, start, end, glyph, max = MAX_COMMENT) {
  const s = Math.max(0, Math.min(start ?? value.length, value.length)), e = Math.max(s, Math.min(end ?? s, value.length));
  const next = value.slice(0, s) + glyph + value.slice(e);
  return next.length > max ? { value, cursor: s } : { value: next, cursor: s + glyph.length };
}

export function createPause({ onPause, onResume }) {
  let holds = 0;
  return { hold() { if (holds++ === 0) onPause(); }, release() { if (holds > 0 && --holds === 0) onResume(); }, active: () => holds > 0, reset() { holds = 0; } };
}

export function mountStoryInteractions({ view, story, api, toast = () => {}, pause, resume, onSave, onDelete, onShare, onProfile, avatar = "", win = window }) {
  const ownerId = api.me()?.id, isOwner = story.cloud && story.author === ownerId, doc = view.ownerDocument;
  const reduced = !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const layer = doc.createElement("div"); layer.className = "story-burst-layer"; view.append(layer);
  const burst = createBurst({ host: layer, create: () => doc.createElement("span"), reduced });
  const pauser = createPause({ onPause: pause, onResume: resume });
  const bar = doc.createElement("div"); bar.className = "story-bar";
  bar.innerHTML = `<form class="story-compose" aria-label="Reply to Story">
      <input class="story-reply-input" type="text" maxlength="${MAX_COMMENT}" placeholder="Reply…" aria-label="Send a reply" autocomplete="off" />
      <button type="button" class="story-quick-reaction" data-reaction="❤️" aria-label="React with a heart">❤️</button>
      <button type="button" class="story-quick-reaction" data-reaction="😂" aria-label="React with laughter">😂</button>
      <button type="button" class="story-reaction-open" aria-label="More reactions" aria-expanded="false">${icon("smilePlus")}</button>
      <button type="submit" class="story-send" aria-label="Send reply" title="Send reply" hidden>${icon("send")}</button>
    </form>
    <div class="story-owner-controls">
      ${isOwner ? `<button type="button" class="story-activity-open" aria-label="View Story viewers and reactions" title="Story activity">${icon("eye")}</button>` : ""}
      <div class="story-more-wrap">
        <button type="button" class="story-more-open" aria-label="More Story options" aria-expanded="false">${icon("more")}</button>
        <div class="story-more-menu" role="group" aria-label="Story options" hidden>
          ${isOwner ? `<button type="button" class="story-more-item story-save">${story.savedToProfile ? "Remove from profile" : "Save to profile"}</button>
            <label class="story-reply-setting"><span>Who can reply?</span><select class="story-comment-setting" aria-label="Who can reply?"><option value="on" ${story.commentsEnabled !== false ? "selected" : ""}>Allow replies</option><option value="off" ${story.commentsEnabled === false ? "selected" : ""}>Don't allow replies</option></select></label>
            <button type="button" class="story-more-item story-delete">Delete Story</button>` : ""}
          <button type="button" class="story-more-item story-focus-replies">View replies</button>
        </div>
      </div>
    </div>
    <div class="story-reaction-picker" role="group" aria-label="Story reactions" hidden>${QUICK_EMOJI.map(glyph => `<button type="button" data-reaction="${glyph}" aria-label="React ${glyph}">${glyph}</button>`).join("")}</div>`;
  const profileButton = doc.createElement("button");
  profileButton.type = "button";
  profileButton.className = "story-profile-mini";
  profileButton.setAttribute("aria-label", "Open Story author's profile");
  if (avatar) {
    const profileImage = doc.createElement("img");
    profileImage.alt = "";
    profileImage.src = avatar;
    profileImage.onerror = () => { profileImage.hidden = true; };
    profileButton.append(profileImage);
  } else {
    profileButton.innerHTML = icon("user");
  }
  profileButton.onclick = onProfile;
  bar.prepend(profileButton);
  const sideActions = doc.createElement("div");
  sideActions.className = "story-side-actions";
  sideActions.innerHTML = `<button type="button" class="story-heart" aria-label="Like Story" aria-pressed="false">${icon("heart")}</button>
    <button type="button" class="story-share" aria-label="Share Story">${icon("share", true, 0)}</button>`;
  view.append(bar);
  view.append(sideActions);
  const liveChat = doc.createElement("div");
  liveChat.className = "story-live-chat";
  liveChat.setAttribute("role", "log");
  liveChat.setAttribute("aria-label", "Story replies");
  liveChat.setAttribute("aria-live", "polite");
  liveChat.hidden = true;
  view.append(liveChat);
  const compose = bar.querySelector(".story-compose"), field = bar.querySelector(".story-reply-input");
  const sendButton = bar.querySelector(".story-send"), heartButton = sideActions.querySelector(".story-heart");
  const shareButton = sideActions.querySelector(".story-share");
  const activityButton = bar.querySelector(".story-activity-open");
  const moreButton = bar.querySelector(".story-more-open"), moreMenu = bar.querySelector(".story-more-menu");
  const reactionButton = bar.querySelector(".story-reaction-open"), reactionPicker = bar.querySelector(".story-reaction-picker");
  const quickReactions = [...bar.querySelectorAll(".story-quick-reaction")];
  let disposed = false, activityPanel = null, pollTimer = null, replyHold = false;
  if (!story.cloud) {
    heartButton.disabled = true;
    heartButton.setAttribute("aria-label", "Story reactions require an online Story");
    reactionButton.disabled = true;
    reactionButton.setAttribute("aria-label", "Story reactions require an online Story");
    for (const button of quickReactions) button.disabled = true;
  }
  if (!story.cloud || typeof onShare !== "function") shareButton.hidden = true;
  const syncComposer = () => {
    const hasText = !!field.value.trim();
    sendButton.hidden = !hasText;
    reactionButton.hidden = hasText;
    quickReactions.forEach(button => { button.hidden = hasText; });
  };
  field.oninput = syncComposer;
  syncComposer();
  field.onfocus = () => { if (!replyHold) { replyHold = true; pauser.hold(); } };
  field.onblur = () => { if (replyHold) { replyHold = false; pauser.release(); } };

  const updateReactionState = () => {
    const liked = story.viewerReaction === "❤️";
    heartButton.classList.toggle("is-liked", liked);
    heartButton.setAttribute("aria-pressed", String(liked));
    for (const button of quickReactions) {
      const selected = story.viewerReaction === button.dataset.reaction;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    for (const button of reactionPicker.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(story.viewerReaction === button.dataset.reaction));
    }
  };
  const refreshReplies = () => {
    const enabled = story.cloud && story.commentsEnabled !== false;
    compose.hidden = !enabled;
    bar.querySelector(".story-focus-replies").hidden = !enabled;
    if (!enabled) liveChat.hidden = true;
  };
  const renderReplies = () => {
    liveChat.replaceChildren();
    const comments = (story.comments || []).slice(-3);
    liveChat.hidden = !comments.length || story.commentsEnabled === false;
    for (const item of comments) {
      const row = doc.createElement("div"); row.className = "story-live-message";
      const message = doc.createElement("span");
      const name = doc.createElement("b"); name.textContent = `@${item.username || api.user(item.author)?.username || "member"} `;
      const body = doc.createElement("span"); body.textContent = item.text;
      message.append(name, body); row.append(message);
      if (item.author === ownerId || isOwner) {
        const remove = doc.createElement("button");
        remove.type = "button"; remove.className = "story-comment-delete";
        remove.setAttribute("aria-label", "Delete reply"); remove.title = "Delete reply";
        remove.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
        remove.onclick = async () => {
          try {
            await api.deleteCloudStoryComment(story.id, item.id);
            story.comments = (story.comments || []).filter(comment => comment.id !== item.id);
            renderReplies();
          } catch (error) { toast(error.message || "Reply could not be deleted."); }
        };
        row.append(remove);
      }
      liveChat.append(row);
    }
  };
  const loadReplies = async () => {
    if (!story.cloud || story.commentsEnabled === false || disposed) return;
    try {
      await api.loadCloudStoryComments(story.id);
      if (!disposed) { liveChat.classList.remove("has-error"); renderReplies(); }
    } catch (error) {
      if (!disposed && !story.comments?.length) {
        liveChat.textContent = error.message || "Replies could not be loaded.";
        liveChat.hidden = false;
        liveChat.classList.add("has-error");
      }
    }
  };
  refreshReplies();
  updateReactionState();
  renderReplies();
  if (story.cloud) {
    void loadReplies();
    pollTimer = win.setInterval(() => { void loadReplies(); }, 5000);
  }
  const setting = bar.querySelector(".story-comment-setting");
  if (setting) setting.onchange = async () => {
    const enabled = setting.value === "on";
    try {
      await api.updateCloudStory(story.id, { commentsEnabled: enabled });
      story.commentsEnabled = enabled;
      refreshReplies(); renderReplies();
    } catch (error) {
      setting.value = story.commentsEnabled === false ? "off" : "on";
      toast(error.message || "Story settings could not be saved.");
    }
  };
  const hideReactions = () => { reactionPicker.hidden = true; reactionButton.setAttribute("aria-expanded", "false"); };
  const closeMenu = () => { moreMenu.hidden = true; moreButton.setAttribute("aria-expanded", "false"); };
  moreButton.onclick = () => {
    hideReactions();
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute("aria-expanded", String(!moreMenu.hidden));
  };
  bar.querySelector(".story-focus-replies").onclick = () => { closeMenu(); field.focus({ preventScroll: true }); };
  const saveButton = bar.querySelector(".story-save");
  if (saveButton) saveButton.onclick = async () => {
    try {
      await onSave?.();
      saveButton.textContent = story.savedToProfile ? "Remove from profile" : "Save to profile";
      toast(story.savedToProfile ? "Saved to your profile" : "Removed from your profile");
      closeMenu();
    } catch (error) { toast(error.message || "Story could not be saved."); }
  };
  const deleteButton = bar.querySelector(".story-delete");
  if (deleteButton) deleteButton.onclick = async () => {
    closeMenu();
    await onDelete?.();
  };
  const pointAt = element => { const box = view.getBoundingClientRect(), r = element.getBoundingClientRect(); return [r.left - box.left + r.width / 2, r.top - box.top + r.height / 2]; };
  const saveReaction = async emoji => {
    if (!story.cloud) { toast("This Story is not available online for reactions."); return; }
    const previous = story.viewerReaction || null;
    try {
      if (previous === emoji) {
        await api.removeCloudStoryReaction(story.id);
        story.viewerReaction = null;
      } else {
        story.viewerReaction = emoji;
        updateReactionState();
        await api.setCloudStoryReaction(story.id, emoji);
      }
      updateReactionState();
      burst.spawn(...pointAt(heartButton), emoji);
    } catch (error) {
      story.viewerReaction = previous;
      updateReactionState();
      toast(error.message || "Your reaction could not be sent.");
    }
  };
  heartButton.onclick = () => { void saveReaction("❤️"); };
  reactionButton.onclick = () => {
    closeMenu();
    reactionPicker.hidden = !reactionPicker.hidden;
    reactionButton.setAttribute("aria-expanded", String(!reactionPicker.hidden));
  };
  reactionPicker.querySelectorAll("button").forEach(button => button.onclick = () => {
    hideReactions();
    void saveReaction(button.dataset.reaction);
  });
  quickReactions.forEach(button => button.onclick = () => { void saveReaction(button.dataset.reaction); });
  shareButton.onclick = async () => {
    shareButton.disabled = true;
    try {
      const result = await onShare?.();
      if (result === "copied") toast("Story link copied");
      else if (result === "failed") toast("Story link could not be shared or copied.");
    } catch (error) { toast(error.message || "Story could not be shared."); }
    finally { shareButton.disabled = false; }
  };
  compose.onsubmit = async event => {
    event.preventDefault();
    try {
      const body = validateStoryComment(field.value);
      sendButton.disabled = true;
      const comment = await api.sendCloudStoryComment(story.id, body);
      story.comments = [...(story.comments || []), comment].slice(-200);
      field.value = "";
      syncComposer();
      liveChat.classList.remove("has-error");
      renderReplies();
    } catch (error) { toast(error.message || "Reply could not be sent."); }
    finally { sendButton.disabled = false; }
  };

  const closeActivity = () => {
    if (!activityPanel) return;
    activityPanel.remove(); activityPanel = null; pauser.release();
  };
  const openActivity = async () => {
    if (!isOwner || activityPanel) return;
    closeMenu(); hideReactions(); pauser.hold();
    activityPanel = doc.createElement("section");
    activityPanel.className = "story-insights";
    activityPanel.setAttribute("role", "dialog");
    activityPanel.setAttribute("aria-label", "Story activity");
    activityPanel.innerHTML = `<header class="story-insights-head"><div><b>Story activity</b><span class="story-insights-summary">Loading…</span></div><button type="button" class="story-insights-close" aria-label="Close Story activity">${icon("close")}</button></header><ul class="story-insights-list" aria-live="polite"></ul>`;
    view.append(activityPanel);
    activityPanel.querySelector(".story-insights-close").onclick = closeActivity;
    const list = activityPanel.querySelector(".story-insights-list");
    try {
      const activity = await api.loadCloudStoryActivity(story.id);
      if (!activityPanel || disposed) return;
      const summary = activityPanel.querySelector(".story-insights-summary");
      const ownReaction = isOwner && story.viewerReaction ? ` · You: ${story.viewerReaction}` : "";
      summary.textContent = `${activity.viewCount} ${activity.viewCount === 1 ? "view" : "views"} · ${activity.reactionCount} ${activity.reactionCount === 1 ? "reaction" : "reactions"}${ownReaction}`;
      if (!activity.viewers.length) {
        const empty = doc.createElement("li"); empty.className = "story-insights-empty"; empty.textContent = "No views yet."; list.append(empty);
      }
      for (const viewer of activity.viewers) {
        const row = doc.createElement("li"); row.className = "story-insights-person";
        const user = api.user(viewer.id), avatar = doc.createElement("img");
        avatar.alt = ""; avatar.src = user?.avatar || ""; avatar.onerror = () => { avatar.hidden = true; };
        const identity = doc.createElement("span"); identity.className = "story-insights-identity";
        const name = doc.createElement("b"); name.textContent = viewer.displayName;
        const handle = doc.createElement("small"); handle.textContent = `@${viewer.username}`;
        identity.append(name, handle); row.append(avatar, identity);
        const reaction = doc.createElement("span"); reaction.className = "story-insights-reaction";
        reaction.textContent = viewer.reaction || "Viewed";
        row.append(reaction); list.append(row);
      }
    } catch (error) {
      if (!activityPanel || disposed) return;
      const summary = activityPanel.querySelector(".story-insights-summary");
      summary.textContent = error.message || "Story activity could not be loaded.";
    }
  };
  activityButton?.addEventListener("click", openActivity);
  const media = view.querySelector(".story-stage");
  const tap = event => {
    if (isIgnoredTap(event.target) || activityPanel) return;
    closeMenu();
    hideReactions();
    const box = view.getBoundingClientRect(); burst.spawn(event.clientX - box.left, event.clientY - box.top);
  };
  media?.addEventListener("click", tap);
  return {
    burst,
    closeSheet: closeActivity,
    dispose() {
      disposed = true;
      if (pollTimer) win.clearInterval(pollTimer);
      if (replyHold) { replyHold = false; pauser.release(); }
      closeActivity(); burst.dispose(); pauser.reset();
      media?.removeEventListener("click", tap); bar.remove(); liveChat.remove(); layer.remove();
    },
    isPaused: () => pauser.active(),
  };
}
