import "./creation-hub.css";

let keyHandler = null;
let oldBodyOverflow = "";

export function closeCreationHub() {
  document.querySelector(".ch-back")?.remove();
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = null;
  document.body.style.overflow = oldBodyOverflow;
}

const fallbackIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg>';
const actionIcon = (icons, name) => icons[name] || fallbackIcon;

export function openCreationHub(actions, icons = {}) {
  closeCreationHub();
  const fixedActions = [
    ["story", "Story", icons.timeCircle],
    ["photo", "Main feed", icons.image]
  ];
  const availableActions = fixedActions.filter(([id]) =>
    id === "photo" ? typeof actions.media === "function" : typeof actions[id] === "function"
  );
  const primaryActions = [
    ["studio", "Oldtime Studio", icons.template],
    ["camera", "Camera", icons.camera]
  ].filter(([id]) => typeof actions[id] === "function");
  const quickActions = availableActions.filter(([id]) => id === "board");
  const shareActions = availableActions.filter(([id]) => id !== "board");
  const button = ([id, label, glyph], className = "") => {
    const iconMarkup = glyph || fallbackIcon;
    return `<button type="button" class="${className}" data-ch="${id}">${className.split(/\s+/).includes("ch-primary")
      ? `<span class="ch-primary-icon">${iconMarkup}</span>` : iconMarkup}<span>${label}</span></button>`;
  };

  const back = document.createElement("div");
  back.className = "ch-back";
  back.innerHTML = `
    <main class="ch-page" role="dialog" aria-modal="true" aria-labelledby="ch-title">
      <header class="ch-header">
        <button type="button" class="ch-close" data-ch-close aria-label="Close">${actionIcon(icons, "close")}</button>
        <h1 id="ch-title">Create post</h1>
        <span class="ch-header-spacer" aria-hidden="true"></span>
      </header>
      <div class="ch-scroll">
        <section class="ch-primary-actions" aria-label="Create with Oldtime">
          ${primaryActions.map(item => button(item, "ch-primary")).join("")}
        </section>
        ${quickActions.length ? `<section class="ch-quick-actions" aria-label="Quick actions">${quickActions.map(item => button(item, "ch-quick")).join("")}</section>` : ""}
        <section class="ch-share-section" aria-labelledby="ch-share-title">
          <div class="ch-section-heading"><h2 id="ch-share-title">More ways to share</h2></div>
          <div class="ch-action-grid">${shareActions.map(item => button(item, "ch-row")).join("")}</div>
        </section>
      </div>
      <input class="ch-file" data-ch-file type="file" accept="image/*,video/*" aria-label="Choose a photo or video">
    </main>`;
  document.body.appendChild(back);
  oldBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  const pickMedia = () => back.querySelector("[data-ch-file]")?.click();
  back.addEventListener("click", event => {
    const close = event.target.closest("[data-ch-close]");
    if (close) { closeCreationHub(); return; }
    const target = event.target.closest("[data-ch]");
    if (!target) return;
    const id = target.dataset.ch;
    if (id === "photo") { pickMedia(); return; }
    closeCreationHub();
    actions[id]?.();
  });
  back.querySelector("[data-ch-file]")?.addEventListener("change", event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const kind = file.type.startsWith("video/") ? "video" : "photo";
    closeCreationHub();
    actions.media(file, kind);
  });
  keyHandler = event => {
    if (event.key === "Escape") closeCreationHub();
  };
  document.addEventListener("keydown", keyHandler);
  back.querySelector(".ch-close")?.focus();
}
