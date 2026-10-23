import "./repost-affordance.css";
import { api } from "./store.js";
import { icon } from "./icons.js";

const note = (post, id) => String(post?.repostNotes?.[id] || "").trim().slice(0, 140);

function pick(post) {
  const me = api.me();
  const ids = [...new Set(Array.isArray(post?.reposts) ? post.reposts : [])];
  if (me && ids.includes(me.id)) return { mine: true, user: me };
  for (const id of ids) {
    if (id === me?.id) continue;
    const u = api.user(id);
    if (u && api.canSee(id)) return { mine: false, user: u };
  }
  return null;
}

export function renderRepostAffordance(post, { esc }) {
  if (!post?.id) return "";
  const me = api.me(), found = pick(post);
  if (!found) return "";
  const user = found?.user || me;
  if (!user) return "";
  const text = found ? note(post, user.id) : "";
  const name = user.name || user.username || "member";
  let bubble = "";
  if (text && found.mine) bubble = `<button type="button" class="rp-bubble" data-repost-note="${esc(post.id)}" aria-label="Edit your repost note: ${esc(text)}"><span class="rp-text">${esc(text)}</span></button>`;
  else if (text) bubble = `<div class="rp-bubble rp-other"><span class="rp-text" data-rp-text>${esc(text)}</span><button type="button" class="rp-more" data-rn-read aria-expanded="false" aria-label="Read the full note from ${esc(name)}">Read</button></div>`;
  const face = !found
    ? `<button type="button" class="rp-face" data-repost-note="${esc(post.id)}" aria-label="Add a note to your repost"><img src="${esc(me.avatar || "")}" alt=""><span class="rp-badge">${icon("repost")}</span></button>`
    : found.mine
      ? `<button type="button" class="rp-face" data-repost-note="${esc(post.id)}" aria-label="${text ? "Edit your repost note" : "Your repost. Add a note"}"><img src="${esc(user.avatar || "")}" alt=""><span class="rp-badge">${icon("repost")}</span></button>`
      : `<button type="button" class="rp-face" data-avatar-profile="${esc(user.id)}" aria-label="${esc(name)} reposted this post. Open story or profile"><img src="${esc(user.avatar || "")}" alt=""><span class="rp-badge">${icon("repost")}</span></button>`;
  return `<div class="rp-aff" data-rp-post="${esc(post.id)}" data-rp-note="${text ? "1" : ""}">${bubble}${face}</div>`;
}

export function mountRepostAffordances(root) {
  if (!root) return;
  root.querySelectorAll(".rp-aff [data-rn-read]").forEach(button => button.addEventListener("click", e => {
    const aff = button.closest(".rp-aff");
    const open = aff.classList.toggle("rp-open");
    e.currentTarget.setAttribute("aria-expanded", String(open));
    e.currentTarget.textContent = open ? "Less" : "Read";
  }));
}

export function showRepostedPulse(root, postId) {
  const card = (root || document).querySelector(`.clip[data-id="${CSS.escape(String(postId))}"]`);
  if (!card) return false;
  card.querySelector(".reposted-float")?.remove();
  const badge = document.createElement("div");
  badge.className = "reposted-float";
  badge.setAttribute("role", "status");
  badge.innerHTML = `${icon("repost")}<span>Reposted</span>`;
  card.append(badge);
  setTimeout(() => badge.remove(), 1100);
  return true;
}
