import "./saved-sheets.css";
import "./share-sheet.css";
import { api } from "./store.js";
import {
  listSavedCollections, setPostSaved, createSavedCollection,
  renameSavedCollection, deleteSavedCollection, toggleSavedCollection
} from "./saved-collections.js";
import { renderSavedSheet, renderShareSheet } from "./saved-sheets.js";
import { findSharedComment, listRegularShareFriends, sendPostToFriends } from "./shared-content.js";

export function openSocialSheet({
  id, mode = "saved", commentId = "", sheet, esc, icons, toast, onClose,
  onExternal, onShared, onStory, onRepost
}) {
  const ownerId = api.me()?.id;
  const returnFocus = document.activeElement;
  let editingCollection = null;
  let friendsMode = false;
  let friends = [];
  let friendSearch = "";
  let sendingFriends = false;
  const selectedFriends = new Set();
  const post = () => {
    const item = api.post(id);
    if (api.me()?.id !== ownerId || !item || !api.canSeePost(item)) throw new Error("Post unavailable.");
    if (commentId && !findSharedComment(item, commentId)) throw new Error("Comment unavailable.");
    return item;
  };
  const error = value => {
    const target = sheet.querySelector("[data-sheet-error]");
    if (target) target.textContent = value.message || String(value);
  };
  const close = (refresh = true) => {
    sheet.classList.remove("on");
    sheet.innerHTML = "";
    sheet.onclick = null;
    document.removeEventListener("keydown", keyboard);
    if (refresh) onClose?.();
    if (returnFocus?.isConnected) returnFocus.focus();
  };
  const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const buttons = [...sheet.querySelectorAll("button:not(:disabled), input, textarea")]
      .filter(element => !element.closest("[hidden]"));
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };
  const run = action => {
    try { post(); action(); draw(); }
    catch (failure) { error(failure); }
  };
  const edit = collection => {
    editingCollection = collection?.id || null;
    const form = sheet.querySelector("[data-collection-form]");
    form.hidden = false;
    form.elements.name.value = collection?.name || "";
    form.elements.name.focus();
  };
  const draw = () => {
    const item = post();
    const author = api.user(item.author) || {};
    const preview = { ...item, thumbnail: item.kind === "video" ? item.poster || author.avatar : item.media?.[0] };
    const comment = findSharedComment(item, commentId);
    const saved = Boolean(item.saves?.includes(ownerId) || api.me()?.savedPostIds?.includes(id));
    sheet.innerHTML = mode === "saved"
      ? renderSavedSheet({ post: preview, author, collections: listSavedCollections(id), saved: item.saves?.includes(ownerId), esc, icons })
      : renderShareSheet({ post: preview, author,
        comment: comment ? { ...comment, authorName: "@" + (api.user(comment.author)?.username || "member") } : null,
        friends, friendsMode, selectedFriends: [...selectedFriends], friendSearch, saved,
        reposted: Boolean(item.repostedByMe) || (item.reposts || []).includes(ownerId),
        canRepost: Boolean(item.cloud), esc, icons });
    sheet.querySelector("[data-social-sheet-close]").onclick = () => close();
    if (mode === "saved") {
      sheet.querySelector("[data-saved-toggle]").onclick = () => run(() => setPostSaved(id, !post().saves?.includes(ownerId)));
      sheet.querySelector("[data-collection-new]").onclick = () => edit(null);
      sheet.querySelector("[data-collection-cancel]").onclick = () => {
        editingCollection = null;
        sheet.querySelector("[data-collection-form]").hidden = true;
        sheet.querySelector("[data-collection-new]").focus();
      };
      sheet.querySelector("[data-collection-form]").onsubmit = event => {
        event.preventDefault();
        const name = event.currentTarget.elements.name.value;
        run(() => editingCollection ? renameSavedCollection(editingCollection, name) : createSavedCollection(name, id));
      };
      sheet.querySelectorAll("[data-saved-collection]").forEach(button => {
        button.onclick = () => run(() => toggleSavedCollection(button.dataset.savedCollection, id));
      });
      sheet.querySelectorAll("[data-collection-rename]").forEach(button => {
        button.onclick = () => edit(listSavedCollections(id).find(value => value.id === button.dataset.collectionRename));
      });
      sheet.querySelectorAll("[data-collection-delete]").forEach(button => {
        button.onclick = () => {
          if (confirm("Delete this collection? Saved posts will be kept.")) {
            run(() => deleteSavedCollection(button.dataset.collectionDelete));
          }
        };
      });
    } else {
      sheet.querySelector("[data-share-repost]")?.addEventListener("click", async () => {
        try {
          const item = post();
          if (!item.cloud) throw new Error("This post must be online before it can be reposted.");
          const completed = await onRepost?.(id);
          if (completed) close(false);
        } catch (failure) { error(failure); }
      });
      sheet.querySelector("[data-share-save]")?.addEventListener("click", () => {
        try {
          const next = !saved;
          setPostSaved(id, next);
          toast(next ? "Saved" : "Removed from saved");
          close();
        } catch (failure) { error(failure); }
      });
      sheet.querySelector("[data-share-story]")?.addEventListener("click", () => {
        try {
          post();
          // The callback queues the editor into this same sheet; close synchronously before that microtask runs.
          const completed = onStory?.(id, commentId);
          if (completed !== false) close(false);
        } catch (failure) { error(failure); }
      });
      sheet.querySelector("[data-share-friends]")?.addEventListener("click", async () => {
        try {
          post();
          if (api.authMode() === "cloud") {
            await api.refreshCloudRelationships({ force: true, importLegacy: false });
            await api.refreshCloudChats({ force: true, migrateLegacy: false });
          }
          friends = listRegularShareFriends(id);
          friendsMode = true;
          friendSearch = "";
          selectedFriends.clear();
          draw();
          sheet.querySelector("[data-share-search]")?.focus();
        } catch (failure) { error(failure); }
      });
      sheet.querySelector("[data-share-back]")?.addEventListener("click", () => {
        friendsMode = false;
        draw();
        sheet.querySelector("[data-share-friends]")?.focus();
      });
      sheet.querySelector("[data-share-search]")?.addEventListener("input", event => {
        friendSearch = event.currentTarget.value;
        const query = friendSearch.trim().toLowerCase();
        sheet.querySelectorAll("[data-share-cell]").forEach(cell => {
          cell.hidden = query.length > 0 && !cell.dataset.search.includes(query);
        });
      });
      sheet.querySelectorAll("[data-share-friend]").forEach(input => {
        input.addEventListener("change", () => {
          if (input.checked) selectedFriends.add(input.value);
          else selectedFriends.delete(input.value);
          const send = sheet.querySelector("[data-share-submit]");
          if (send) {
            send.disabled = selectedFriends.size === 0 || sendingFriends;
            send.textContent = selectedFriends.size ? `Send (${selectedFriends.size})` : "Send";
          }
        });
      });
      sheet.querySelector("[data-share-submit]")?.addEventListener("click", async () => {
        if (sendingFriends) return;
        try {
          post();
          const recipientIds = [...selectedFriends];
          if (!recipientIds.length) throw new Error("Choose at least one person.");
          const message = sheet.querySelector("[data-share-message]")?.value || "";
          sendingFriends = true;
          const button = sheet.querySelector("[data-share-submit]");
          if (button) button.disabled = true;
          const result = await sendPostToFriends(id, recipientIds, { commentId, message });
          const sentCount = Array.isArray(result) ? result.length : Number(result?.sentCount || 0);
          const failedCount = Array.isArray(result) ? 0 : Number(result?.failedRecipientIds?.length || 0);
          if (!sentCount && failedCount) throw new Error("The post could not be sent to those Friends. Try again.");
          if (failedCount) toast(`Shared with ${sentCount} ${sentCount === 1 ? "person" : "people"}; ${failedCount} could not be reached.`);
          else toast(`Shared with ${sentCount} ${sentCount === 1 ? "person" : "people"}`);
          close();
        } catch (failure) {
          sendingFriends = false;
          error(failure);
          const button = sheet.querySelector("[data-share-submit]");
          if (button) button.disabled = selectedFriends.size === 0;
        }
      });
      sheet.querySelector("[data-share-external]")?.addEventListener("click", async () => {
        try { post(); const result=await onExternal?.(id, commentId); if(result?.completed){close();if(result.kind==="shared")onShared?.(id,result.kind);} }
        catch (failure) { error(failure); }
      });
      sheet.querySelector("[data-share-copylink]")?.addEventListener("click", async () => {
        try {
          post();
          const result = await onExternal?.(id, commentId, "copylink");
          if (result?.completed) close();
        } catch (failure) { error(failure); }
      });
    }
  };
  try {
    if (mode === "saved" && !post().saves?.includes(ownerId)) setPostSaved(id, true);
    draw();
    sheet.classList.add("on");
    sheet.onclick = event => { if (event.target === sheet) close(); };
    document.addEventListener("keydown", keyboard);
    sheet.querySelector("[data-social-sheet-close]")?.focus();
  } catch (failure) {
    close(false);
    toast(failure.message);
  }
}
