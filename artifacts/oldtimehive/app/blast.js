import { hydrateLocalMedia } from "./local-media.js";
import "./blast.css";
import "./blast-video-notes.css";
import { api, fileToData } from "./store.js";
import { mountCreativeViewers, setCreativeMuted } from "./creative-viewer.js";
import { getBlastVideoNote, updateBlastCreativeNote } from "./blast-video-note-store.js";
import { listBlastCommunities, listBlastPosts, updateBlastCreativePost } from "./blast-store.js";
import { openCreativeResponse } from "./creative-responses.js";
import { icon } from "./icons.js";
import * as social from "./blast-social.js";
import * as blastCommunities from "./blast-communities.js";
import { renderBlastInfo } from "./blast-info.js";
import * as notes from "./blast-video-note-view.js";
import * as composer from "./blast-video-note-composer.js";
import { bindBlastSettingsDrawer, renderBlastSettingsDrawer } from "./blast-settings-drawer.js";
import { loadBlastSocialCloudState } from "./blast-store.js";
import { loadBlastVideoNoteCloudState } from "./blast-video-note-store.js";

let activeView = { name: "notes" };
let settingsDrawerOpen = false;
let blastStateAccount = null;
let blastStateLoad = null;
const SOCIAL_VIEWS = ["hub", "create", "detail", "friends", "communities", "community"];
const NOTE_VIEWS = ["notes", "chats", "chat", "note-detail"];
const COMPOSER_VIEWS = ["note-camera", "note-editor"];
const INFO_VIEWS = ["guidelines", "privacy"];

export function setBlastView(next) {
  const requested = next?.name === "hub" ? { name: "notes" } : next;
  activeView = [...SOCIAL_VIEWS, ...NOTE_VIEWS, ...COMPOSER_VIEWS, ...INFO_VIEWS].includes(requested?.name) ? requested : { name: "notes" };
  settingsDrawerOpen = false;
}

export function isBlastGuidanceSafe() {
  return !settingsDrawerOpen && ["notes","hub","friends","chats","communities"].includes(activeView.name);
}

export function renderBlast({ shell, app, toast, esc, onOpenPost, onOpenStory, onCreateStory }) {
  const me = api.me();
  if (!me) return;
  const rerender = () => renderBlast({ shell, app, toast, esc, onOpenPost, onOpenStory, onCreateStory });
  const accountId = api.cloudAccountId();
  if (!accountId) {
    shell(`<main class="blast-screen"><div class="blast-wrap"><p>Sign in to your account to load Community.</p></div></main>`, "light");
    return;
  }
  if (blastStateAccount !== accountId) {
    shell(`<main class="blast-screen"><div class="blast-wrap" role="status">Loading your account-backed Community data…</div></main>`, "light");
    if (!blastStateLoad) {
      blastStateLoad = Promise.all([loadBlastSocialCloudState(), loadBlastVideoNoteCloudState()])
        .then(() => {
          blastStateAccount = accountId;
          rerender();
        })
        .catch(error => {
          console.error("Community cloud data did not load.", error);
          shell(`<main class="blast-screen"><div class="blast-wrap">
            <h1>Community could not load</h1><p>${esc(error?.message || "Check your connection and try again.")}</p>
            <button type="button" class="blast-icon-btn" data-blast-state-retry>Try again</button>
          </div></main>`, "light");
          app.querySelector("[data-blast-state-retry]")?.addEventListener("click", () => {
            blastStateLoad = null;
            rerender();
          }, { once: true });
        })
        .finally(() => { blastStateLoad = null; });
    }
    return;
  }
  const ctx = {
    app, me, toast, esc, icon, fileToData, onOpenStory, onCreateStory,
    getView: () => activeView,
    settingsOpen: settingsDrawerOpen,
    openBlastSettings: () => {
      settingsDrawerOpen = true;
      rerender();
    },
    setView: next => {
      const nextView = typeof next === "string" ? { name: next } : next;
      if (activeView.name === "note-camera" && !["note-camera","note-editor"].includes(nextView.name)) notesComposerClose();
      settingsDrawerOpen = false;
      setBlastView(nextView);
      rerender();
    },
    setFeedFilter: type => {
      if (!notes.setBlastTimelineFilter(type)) return;
      setBlastView({ name: "notes" });
      rerender();
    },
    refresh: rerender,
    page: (title, body, extra = "", back = "hub") => `<main class="blast-screen"><div class="blast-wrap blast-anim">
       <header class="blast-title-row">
         <button type="button" class="blast-back" data-blast-nav="${esc(back)}" aria-label="Return to Community" data-testid="blast-back">${icon("back")}</button>
        <h1>${esc(title)}</h1>
         <button type="button" class="blast-icon-btn" data-blast-nav="notes" aria-label="For you feed" data-testid="blast-feed-home">${icon("home")}</button>
      </header>${extra}${body}</div></main>`
  };
  let output;
  if (activeView.name === "communities" || activeView.name === "community") {
    output = blastCommunities.renderBlastCommunities(activeView, ctx);
  } else if (SOCIAL_VIEWS.includes(activeView.name)) {
    output = social.renderBlastSocial(activeView, ctx);
  } else if (NOTE_VIEWS.includes(activeView.name)) {
    output = notes.renderBlastVideoNotes(activeView, ctx);
  } else if (COMPOSER_VIEWS.includes(activeView.name)) {
    output = composer.renderBlastNoteComposer(activeView, ctx);
  } else {
    output = renderBlastInfo(activeView, ctx);
  }
  const immersiveComposer = COMPOSER_VIEWS.includes(activeView.name);
  const pageOutput = immersiveComposer ? output : wrapBlastWorkspace(output, ctx);
  shell(pageOutput, immersiveComposer ? "dark" : "light", {
    hideNav: activeView.name === "note-camera" || (activeView.name === "create" && activeView.type !== "event")
  });
  if (settingsDrawerOpen) app.insertAdjacentHTML("beforeend", renderBlastSettingsDrawer(ctx));
  app.querySelectorAll("[data-blast-nav]").forEach(button => {
    button.onclick = () => {
      if (button.dataset.blastNav === "community-feed") {
        notes.setBlastTimelineFilter("communities");
        ctx.setView("notes");
        return;
      }
      if (button.dataset.blastNav === "notes") notes.resetBlastTimeline();
      ctx.setView(button.dataset.blastNav);
    };
  });
  app.querySelectorAll("[data-blast-feed-scope]").forEach(button => {
    button.onclick = () => {
      if (!notes.setBlastFeedScope(button.dataset.blastFeedScope)) return;
      ctx.setView("notes");
    };
  });
  app.querySelectorAll("[data-blast-feed-filter]").forEach(button => {
    button.onclick = () => ctx.setFeedFilter(button.dataset.blastFeedFilter);
  });
  app.querySelectorAll("[data-blast-open-source]").forEach(button => {
    button.onclick = () => onOpenPost?.(button.dataset.blastOpenSource, button.dataset.blastOpenComment || "");
  });
  app.querySelectorAll("[data-blast-community-open]").forEach(button => {
    button.onclick = () => ctx.setView({ name: "community", id: button.dataset.blastCommunityOpen });
  });
  void hydrateLocalMedia(app);
  app.querySelectorAll("[data-blast-settings-open]").forEach(button => {
    button.onclick = () => ctx.openBlastSettings();
  });
  if (activeView.name === "communities" || activeView.name === "community") blastCommunities.bindBlastCommunities(activeView, ctx);
  else if (SOCIAL_VIEWS.includes(activeView.name)) social.bindBlastSocial(activeView, ctx);
  else if (NOTE_VIEWS.includes(activeView.name)) {
    notes.bindBlastVideoNotes(activeView, ctx);
    if (activeView.name === "notes") social.bindBlastSocial(activeView, ctx);
  }
  else if (COMPOSER_VIEWS.includes(activeView.name)) composer.bindBlastNoteComposer(activeView, ctx);
  const resolveCreative=id=>{
    const note=getBlastVideoNote(id);
    if(note?.creativeProject)return {...note,author:note.authorId};
    const post=listBlastPosts().find(item=>item.media?.creativeId===id);
    return post?{id,author:post.authorId,creativeProject:post.media.creativeProject}:null;
  };
  mountCreativeViewers(app,{
    onSource:onOpenPost,canViewItem:()=>true,
    resolveItem:resolveCreative,
    onSticker:(id,layer)=>openCreativeResponse(id,false,layer,{get:()=>resolveCreative(id),
      save:change=>getBlastVideoNote(id)?updateBlastCreativeNote(id,change):updateBlastCreativePost(id,change)})
  });
  app.querySelector("[data-bvn-creative-audio]")?.addEventListener("click",event=>{
    const button=event.currentTarget,unmute=button.getAttribute("aria-pressed")!=="true";
    setCreativeMuted(app,!unmute);button.setAttribute("aria-pressed",String(unmute));button.textContent=unmute?"Mute video":"Unmute video";
  });
  if (settingsDrawerOpen) {
    bindBlastSettingsDrawer(app, () => {
      settingsDrawerOpen = false;
      rerender();
      [...app.querySelectorAll("[data-blast-settings-open]")]
        .find(button => button.getClientRects().length > 0)?.focus();
    });
  }
}

function wrapBlastWorkspace(output, ctx) {
  const primary = [
    ["home", "Home", "home", "tab", "updates"],
    ["community", "Community", "users", "tab", "blast"],
    ["messages", "Messages", "comment", "tab", "chat"],
    ["profile", "Profile", "user", "tab", "profile"]
  ];
  const nav = primary.map(([key, label, glyph, action, value]) => {
    const current = key === "community"
      ? ["notes", "communities", "community"].includes(ctx.getView().name)
      : key === "messages"
        ? ctx.getView().name === "chats" || ctx.getView().name === "chat"
        : false;
    const target = action === "tab"
      ? `data-tab="${value}"`
      : action === "route"
        ? `data-drawer-route="${value}"`
        : `data-blast-nav="${value}"`;
    return `<button type="button" class="blast-x-nav-link ${current ? "is-current" : ""}"
      ${target} ${current ? 'aria-current="page"' : ""} aria-label="${label}" title="${label}" data-testid="blast-x-nav-${key}">
      ${ctx.icon(glyph)}<span>${label}</span>
    </button>`;
  }).join("");
  const account = ctx.me?.username
    ? `<div class="blast-x-account"><span class="blast-x-account-name">${ctx.esc(ctx.me.name || ctx.me.username)}</span><span>@${ctx.esc(ctx.me.username)}</span></div>`
    : "";
  const discoverCommunities = listBlastCommunities().slice(0, 3).map(community => `
    <button class="blast-x-community-link" type="button" data-blast-nav="communities" aria-label="Explore ${ctx.esc(community.name)}">
      <span class="blast-x-community-icon">${ctx.icon(community.icon)}</span>
      <span><b>${ctx.esc(community.name)}</b><small>${ctx.esc(community.category)}</small></span>
      <span class="blast-x-community-arrow" aria-hidden="true">›</span>
    </button>`).join("");
  return `<div class="blast-x-workspace">
    <aside class="blast-x-sidebar" aria-label="Oldtime navigation">
      <button class="blast-x-wordmark" type="button" data-tab="blast" aria-label="Community home">
        <span class="blast-x-mark" aria-hidden="true">${ctx.icon("users")}</span><span>Community</span>
      </button>
      <nav class="blast-x-primary-nav" aria-label="Main navigation">${nav}</nav>
      <button class="blast-x-post-button" type="button" data-blast-nav="create" data-testid="blast-desktop-compose">Create</button>
      <div class="blast-x-sidebar-bottom">
        ${account}
        <button type="button" class="blast-x-nav-link" data-blast-settings-open aria-label="Open community options">
          ${ctx.icon("settings")}<span>More</span>
        </button>
      </div>
    </aside>
    ${output}
    <aside class="blast-x-right-rail" aria-label="Community discovery">
      <section class="blast-x-rail-card">
        <h2>Discover</h2>
        <p>Find communities for the things you care about.</p>
        ${discoverCommunities}
        <button type="button" data-blast-nav="communities">Explore all communities</button>
      </section>
      <footer class="blast-x-footer">Oldtime · Community</footer>
    </aside>
  </div>`;
}

function notesComposerClose() {
  composer.closeBlastNoteCamera(true);
}

export default renderBlast;
