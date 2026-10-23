import { BLAST_COMMUNITY_CATEGORIES, getBlastCommunity } from "./blast-community-data.js";
import {
  joinBlastCommunity,
  leaveBlastCommunity,
  listBlastCommunities,
  listBlastCommunityPosts,
} from "./blast-store.js";
import { renderBlastTimelinePost } from "./blast-social.js";

let query = "";
let category = "All";
let scope = "discover";

const navTab = (label, destination, active, icon) =>
  `<button class="blast-tab ${active ? "is-active" : ""}" type="button" data-blast-nav="${destination}" ${active ? 'aria-current="page"' : ""}>${icon}${label}</button>`;

function directoryCard(community, esc, icon) {
  return `<article class="blast-community-card" data-testid="blast-community-${esc(community.id)}">
    <button type="button" class="blast-community-open" data-blast-community-open="${esc(community.id)}" aria-label="Open ${esc(community.name)}">
      <span class="blast-community-glyph" aria-hidden="true">${icon(community.icon)}</span>
      <span class="blast-community-copy"><span class="blast-community-category">${esc(community.category)}</span><b>${esc(community.name)}</b><span>${esc(community.description)}</span></span>
    </button>
    <button type="button" class="blast-community-join ${community.joined ? "is-joined" : ""}" data-blast-community-join="${esc(community.id)}" aria-pressed="${community.joined}" data-testid="blast-community-join-${esc(community.id)}">${community.joined ? "Joined" : "Join"}</button>
  </article>`;
}

function directory(ctx) {
  const { esc, icon } = ctx;
  const directoryTabs = `<div class="blast-community-directory-tabs" role="tablist" aria-label="Community sections">
    <button type="button" role="tab" aria-selected="${scope === "discover"}" class="${scope === "discover" ? "is-active" : ""}" data-blast-community-scope="discover">Discover</button>
    <button type="button" role="tab" aria-selected="${scope === "joined"}" class="${scope === "joined" ? "is-active" : ""}" data-blast-community-scope="joined">Joined <span>${listBlastCommunities().filter(item => item.joined).length}</span></button>
  </div>`;
  const communities = listBlastCommunities()
    .filter(item => scope !== "joined" || item.joined)
    .filter(item => category === "All" || item.category === category)
    .filter(item => !query || `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const categories = BLAST_COMMUNITY_CATEGORIES.map(item =>
    `<button type="button" class="blast-community-filter ${category === item ? "is-active" : ""}" data-blast-community-category="${esc(item)}" aria-pressed="${category === item}">${esc(item)}</button>`
  ).join("");
  const cards = communities.map(item => directoryCard(item, esc, icon)).join("");
  return ctx.page("Communities", `
    <nav class="blast-tabs blast-community-tabs" aria-label="Community sections">
      ${navTab("For you", "notes", false, "")}
      <button class="blast-tab" type="button" data-bvn-open-feed="following">Following</button>
      ${navTab("Communities", "communities", true, "")}
    </nav>
    ${directoryTabs}
    <section class="blast-community-intro"><span class="blast-eyebrow">${scope === "joined" ? "YOUR COMMUNITIES" : "FIND YOUR CIRCLE"}</span><h2>${scope === "joined" ? "Your conversations, together." : "Find a circle that feels like yours."}</h2><p>${scope === "joined" ? "Open a community to catch up, or discover somewhere new." : "Join a community to share short posts and moments with people who get it."}</p></section>
    <form class="blast-community-search" data-blast-community-search-form>
      <input class="blast-input" type="search" name="query" value="${esc(query)}" placeholder="Search communities" aria-label="Search communities" />
      <button class="blast-search-submit" type="submit" aria-label="Search communities">${icon("search")}</button>
    </form>
    <div class="blast-community-filters" aria-label="Community topics">${categories}</div>
    <section class="blast-community-list" aria-label="${scope === "joined" ? "Joined communities" : "Discover communities"}">
      ${cards || `<div class="blast-card blast-empty"><span class="blast-empty-mark">${icon("users")}</span><h3>${scope === "joined" ? "Your circle is still open" : "No communities found"}</h3><p>${scope === "joined" ? "Join a community and it will show up here." : "Try another search or topic."}</p></div>`}
    </section>`, "", "hub");
}

function detail(view, ctx) {
  const community = getBlastCommunity(view.id);
  if (!community) return directory(ctx);
  const listed = listBlastCommunities().find(item => item.id === community.id);
  const posts = listed?.joined ? listBlastCommunityPosts(community.id) : [];
  const postCards = posts.map(post => renderBlastTimelinePost(post, ctx)).join("");
  const { esc, icon } = ctx;
  return ctx.page("Community", `
    <nav class="blast-tabs blast-community-tabs" aria-label="Community sections">
      ${navTab("For you", "notes", false, "")}
      <button class="blast-tab" type="button" data-bvn-open-feed="following">Following</button>
      ${navTab("Communities", "communities", true, "")}
    </nav>
    <section class="blast-community-detail-card">
      <div class="blast-community-detail-heading">
        <span class="blast-community-glyph" aria-hidden="true">${icon(community.icon)}</span>
        <div><span class="blast-community-category">${esc(community.category)}</span><h2>${esc(community.name)}</h2></div>
      </div>
      <p class="blast-community-detail-description">${esc(community.description)}</p>
      <div class="blast-community-detail-actions">
        <button type="button" class="blast-community-join ${listed?.joined ? "is-joined" : ""}" data-blast-community-join="${esc(community.id)}" aria-pressed="${!!listed?.joined}" data-testid="blast-community-detail-join">${listed?.joined ? "Joined" : "Join community"}</button>
        ${listed?.joined ? `<button type="button" class="blast-community-post" data-blast-community-post="${esc(community.id)}" data-testid="blast-community-post">Write a post</button>` : ""}
      </div>
      ${!listed?.joined ? `<p class="blast-community-members-only">Membership keeps this conversation within the community. Join to view posts and take part.</p>` : ""}
    </section>
    ${listed?.joined ? `<div class="blast-community-conversation-heading"><div><span class="blast-eyebrow">MEMBER CONVERSATION</span><h2>Latest posts</h2></div><span>${posts.length} ${posts.length === 1 ? "post" : "posts"}</span></div>
      ${postCards || `<section class="blast-card blast-empty"><span class="blast-empty-mark">${icon("comment")}</span><h3>Start the conversation</h3><p>There aren’t any posts here yet. Share the first thought with this community.</p><button class="blast-primary" type="button" data-blast-community-post="${esc(community.id)}">Write a post</button></section>`}` : ""}`,
    "", "communities");
}

export function renderBlastCommunities(view, ctx) {
  return view.name === "community" ? detail(view, ctx) : directory(ctx);
}

export function bindBlastCommunities(view, ctx) {
  const { app, toast } = ctx;
  app.querySelectorAll("[data-blast-community-scope]").forEach(button => button.onclick = () => {
    scope = button.dataset.blastCommunityScope;
    ctx.refresh();
  });
  app.querySelectorAll("[data-blast-community-category]").forEach(button => button.onclick = () => {
    category = button.dataset.blastCommunityCategory;
    ctx.refresh();
  });
  const search = app.querySelector("[data-blast-community-search-form]");
  if (search) search.onsubmit = event => {
    event.preventDefault();
    query = String(new FormData(search).get("query") || "").trim();
    ctx.refresh();
  };
  app.querySelectorAll("[data-blast-community-open]").forEach(button => button.onclick = () => {
    ctx.setView({ name: "community", id: button.dataset.blastCommunityOpen });
  });
  app.querySelectorAll("[data-blast-community-join]").forEach(button => button.onclick = async () => {
    try {
      const id = button.dataset.blastCommunityJoin;
      const joined = button.getAttribute("aria-pressed") !== "true";
      if (joined) await joinBlastCommunity(id);
      else await leaveBlastCommunity(id);
      toast(joined ? "Community joined." : "You left the community.");
      ctx.refresh();
    } catch (error) { toast(error.message || "Could not update membership."); }
  });
  app.querySelectorAll("[data-blast-community-post]").forEach(button => button.onclick = () => {
    ctx.setView({ name: "create", type: "post", communityId: button.dataset.blastCommunityPost });
  });
}
