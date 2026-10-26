# TikTok nav + styles restore

## 1. Restore full styles.css (required)

`styles.css` was partially overwritten during the nav work. Restore the full file from history:

```bash
git fetch origin
git checkout 8a4bc62e633a32522cf200f2479942acdb7bb35c -- artifacts/oldtimehive/app/styles.css
# Then re-append TikTok create button styles (or keep tiktok-nav.css import)
git add artifacts/oldtimehive/app/styles.css
git commit -m "restore full styles.css"
git push
```

Or on GitHub: open that commit → `styles.css` → copy full content → paste into main `styles.css`.

After restore, ensure `app.js` still has:
```js
import "./tiktok-nav.css";
```

## 2. Bottom nav change (app.js)

Replace the bottom `<nav class="nav"...>` block with:

```html
<nav class="nav ..." aria-label="Primary navigation">
  <button type="button" data-tab="updates" ...>Home</button>
  <button type="button" data-tab="communities" ...>Community</button>
  <button type="button" class="nav-create" id="nav-create" aria-label="Create" data-testid="button-nav-create">
    <span class="nav-create-plus" aria-hidden="true">+</span>
  </button>
  <button type="button" data-tab="chat" ...>Chat</button>
  <button type="button" data-tab="profile" ...>Profile</button>
</nav>
```

Remove the Search `data-tab="search"` button from the bottom nav.

Wire create:
```js
const navCreate = $("#nav-create");
if (navCreate) navCreate.onclick = () => openHomeCreate();
```

Search stays top-right on Home (already present).

## 3. Already shipped

- `creation-hub.js` — camera-first TikTok create sheet
- `tiktok-nav.css` — cyan→pink center + button
