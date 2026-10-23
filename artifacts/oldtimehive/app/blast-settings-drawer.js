const SETTINGS_ITEMS = [
  ["saved", "Saved posts", "bookmark"],
  ["friends", "Friends & requests", "users"],
  ["guidelines", "Community guidelines", "lock"],
  ["privacy", "Privacy summary", "lock"]
];

export function renderBlastSettingsDrawer(ctx) {
  return `<div class="bvn-drawer-backdrop" data-blast-drawer-backdrop>
    <aside class="bvn-settings-drawer" role="dialog" aria-modal="true" aria-labelledby="bvn-settings-title" data-blast-settings-drawer>
      <header class="bvn-settings-header">
        <div><span class="bvn-kicker">COMMUNITY</span><h2 id="bvn-settings-title">More options</h2></div>
        <button type="button" class="bvn-icon-button" data-blast-drawer-close aria-label="Close community options">${ctx.icon("close")}</button>
      </header>
      <nav class="bvn-settings-list" aria-label="Community options">
        ${SETTINGS_ITEMS.map(([view, label, glyph]) => `<button type="button" class="bvn-settings-item" ${view === "saved" ? 'data-blast-feed-filter="saved"' : `data-blast-nav="${view}"`} data-testid="community-nav-${view}">
          <span class="bvn-settings-icon">${ctx.icon(glyph)}</span>
          <span class="bvn-settings-copy"><b>${ctx.esc(label)}</b></span>
          <span class="bvn-settings-chevron" aria-hidden="true">${ctx.icon("more")}</span>
        </button>`).join("")}
      </nav>
    </aside>
  </div>`;
}

export function bindBlastSettingsDrawer(app, close) {
  const backdrop = app.querySelector("[data-blast-drawer-backdrop]");
  const drawer = app.querySelector("[data-blast-settings-drawer]");
  if (!backdrop || !drawer) return;

  const closeButton = drawer.querySelector("[data-blast-drawer-close]");
  closeButton?.addEventListener("click", close);
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  drawer.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  closeButton?.focus();
}
