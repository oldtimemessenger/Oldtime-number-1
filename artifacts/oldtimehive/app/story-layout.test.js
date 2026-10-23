import { readFileSync } from "node:fs";
import assert from "node:assert";
import { test } from "node:test";
const js = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
test("narrow Messages headers reserve separate title and action columns",()=>{
  assert.match(css,/\.chat-list-topline\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css,/\.chat-list-topline \.chat-head-actions\s*\{[^}]*position:static/);
  assert.doesNotMatch(readFileSync(new URL("./chat.js",import.meta.url),"utf8"),/id="saved"/);
});
test("long chat names truncate independently of verification badges",()=>{
  const chat=readFileSync(new URL("./chat.js",import.meta.url),"utf8");
  assert.match(chat,/class="chat-identity-name"/);
  assert.match(css,/\.chat-identity-name\s*\{[^}]*text-overflow:ellipsis/);
  assert.match(css,/\.chat-identity-copy \.verified\s*\{[^}]*flex:0 0 auto/);
});
test("Settings reserves separate account-name and profile-action columns",()=>{
  assert.match(css,/\.account-settings-screen \.settings-account-card\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\) auto/);
  assert.match(css,/\.account-settings-screen \.settings-account-card > span:nth-child\(2\)\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
});
test("full feed captions stay scrollable above the audio and navigation controls",()=>{
  assert.match(css,/\.clip \.meta\s*\{[^}]*bottom:calc\(158px[^}]*max-height:calc\(100% - 362px[^}]*overflow-y:auto[^}]*overscroll-behavior-y:contain/);
  assert.match(js,/<div class="meta" tabindex="0" aria-label="Post details">/);
});
test("story usernames are bounded", () => {
  assert.match(js, /<button type="button" class="story-name" data-profile="\$\{esc\(id\)\}"/);
  assert.match(js, /class="story-avatar-action" data-avatar-profile="\$\{esc\(id\)\}"/);
  assert.match(css, /\.story-name\s*\{[^}]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.story\s*\{[^}]*flex:\s*0 0 68px/);
});
test("story media fills the viewer and reply permissions stay in the options menu", () => {
  const interactions = readFileSync(new URL("./story-interactions.js", import.meta.url), "utf8");
  const interactionCss = readFileSync(new URL("./story-interactions.css", import.meta.url), "utf8");
  const icons = readFileSync(new URL("./icons.js", import.meta.url), "utf8");
  assert.match(js, /class="story-stage"/);
  assert.match(js, /class="story-stage-media"/);
  assert.match(interactionCss, /\.story-stage-media,[\s\S]*?object-fit:\s*cover/);
  assert.match(interactionCss, /\.storyview > \.story-stage\s*\{[^}]*inset:0/);
  assert.match(js, /class="story-header"/);
  assert.match(js, /Close Story/);
  assert.match(interactions, /class="story-more-open"/);
  assert.match(interactions, /class="story-comment-setting"/);
  assert.match(interactionCss, /\.story-more-menu\[hidden\][^{]*\{\s*display:none/);
  assert.match(interactions, /liveChat\.className = "story-live-chat"/);
  assert.match(interactions, /class="story-activity-open"/);
  assert.match(interactions, /sideActions\.className = "story-side-actions"/);
  assert.match(interactions, /class="story-quick-reaction"/);
  assert.match(interactions, /onShare/);
  assert.match(interactions, /story-activity-open[\s\S]*?story-more-open/);
  assert.match(interactionCss, /\.story-reaction-picker\s*\{[^}]*background:transparent/);
  assert.match(icons, /more: '<circle cx="12" cy="5"[\s\S]*?cy="12"[\s\S]*?cy="19"/);
  assert.match(icons, /eye: '<path/);
  assert.match(icons, /smilePlus: '<circle/);
  assert.match(js, /id="sclose"/);
  assert.doesNotMatch(js, /id="ssave"|id="sdelete"/);
  assert.doesNotMatch(interactions, /story-close-menu|Close story/);
});
test("Story sharing opens a specific cloud Story and keeps access checks", () => {
  assert.match(js, /url\.searchParams\.set\("story", s\.id\)/);
  assert.match(js, /pendingStoryId = params\.get\("story"\)/);
  assert.match(js, /await api\.refreshCloudStories\(\)/);
  assert.match(js, /api\.canSeeStory\(story\)/);
  assert.match(js, /openStory\(story\.author, story\.id\)/);
});
test("stories share one expiry rule and the prompt sticker uses original Oldtime wording", () => {
  const lifecycle = readFileSync(new URL("./story-lifecycle.js", import.meta.url), "utf8");
  const interactions = readFileSync(new URL("./story-interactions.js", import.meta.url), "utf8");
  const blast = readFileSync(new URL("./blast-social.js", import.meta.url), "utf8");
  const chat = readFileSync(new URL("./chat.js", import.meta.url), "utf8");
  assert.match(lifecycle, /STORY_LIFETIME_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(js, /isStoryActive\(s\)/);
  assert.match(blast, /isStoryActive\(story\)/);
  assert.match(chat, /isStoryActive\(story\)/);
  assert.doesNotMatch(interactions, /Keep on profile/);
  assert.match(interactions, /Save to profile/);
  assert.match(interactions, /onSave/);
  assert.match(js, /Share your take/);
  assert.doesNotMatch(js, /Add yours/);
});
