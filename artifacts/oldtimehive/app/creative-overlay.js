// Shared overlay behaviour for the creative editor: sheets, swipe-to-dismiss and the visual viewport.
// Pure helpers are exported separately so they can be tested without a browser.

export function viewportMetrics(vv, innerHeight = 0) {
  if (!vv) return { height: null, top: 0, left: 0, width: null, keyboard: 0 };
  const top = Math.max(0, Math.round(vv.offsetTop || 0));
  return { height: Math.round(vv.height), top, left: Math.max(0, Math.round(vv.offsetLeft || 0)), width: Math.round(vv.width),
    keyboard: Math.max(0, Math.round(innerHeight - vv.height - top)) };
}

export function applyViewport(editor, metrics) {
  const set = (name, value) => value == null ? editor.style.removeProperty(name) : editor.style.setProperty(name, `${value}px`);
  set("--ce-viewport-height", metrics.height); set("--ce-vv-top", metrics.height == null ? null : metrics.top);
  set("--ce-vv-left", metrics.height == null ? null : metrics.left); set("--ce-vv-width", metrics.width);
  set("--ce-keyboard", metrics.keyboard);
  editor.classList.toggle("is-keyboard-open", metrics.keyboard > 120);
}

export function createSwipeTracker({ distance = 72, slop = 10, velocity = 0.45 } = {}) {
  let s = null;
  return {
    start(x, y, { scrollTop = 0, t = 0 } = {}) { s = { x, y, t, scrollTop, mode: "pending", dy: 0 }; },
    move(x, y) {
      if (!s) return { mode: "ignore", dy: 0 };
      const dx = x - s.x, dy = y - s.y;
      if (s.mode === "pending") {
        if (Math.abs(dx) < slop && Math.abs(dy) < slop) return { mode: "pending", dy: 0 };
        s.mode = dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && s.scrollTop <= 0 ? "drag" : "ignore";
      }
      if (s.mode === "drag") s.dy = Math.max(0, dy);
      return { mode: s.mode, dy: s.dy };
    },
    end(t = 0) {
      if (!s) return false;
      const dismiss = s.mode === "drag" && (s.dy >= distance || (s.dy >= 24 && s.dy / Math.max(1, t - s.t) >= velocity));
      s = null; return dismiss;
    },
    cancel() { s = null; },
  };
}

// Sliders, pickers and text fields own their own horizontal/vertical gestures.
export const NO_SWIPE = "input,select,textarea,[contenteditable=true],summary";
export const canStartSwipe = target => {
  if (!target?.closest) return true;
  if (target.closest("[data-ce-grip]")) return true;
  return !target.closest(NO_SWIPE);
};

export function createSheetRegistry() {
  const sheets = new Map();
  return {
    register(name, sheet) { sheets.set(name, sheet); },
    isOpen(name) { return !!sheets.get(name)?.isOpen(); },
    anyOpen(skip = []) { return [...sheets].some(([name, sheet]) => !skip.includes(name) && sheet.isOpen()); },
    // Closes every open sheet except the ones named in `except` (the tool being opened) or `skip`.
    dismissAll({ except = [], skip = [] } = {}) {
      const keep = [].concat(except, skip); let any = false;
      for (const [name, sheet] of sheets) if (!keep.includes(name) && sheet.isOpen()) { sheet.close(); any = true; }
      return any;
    },
  };
}

export function bindViewport({ editor, win = window }) {
  const vv = win.visualViewport;
  const sync = () => {
    applyViewport(editor, viewportMetrics(vv, win.innerHeight));
    // Safari scrolls the layout viewport to reveal a focused field; keep the editor pinned.
    if (editor.classList.contains("is-typing") && (win.scrollY || win.scrollX)) win.scrollTo(0, 0);
  };
  const delayed = () => { sync(); win.setTimeout(sync, 120); win.setTimeout(sync, 350); };
  vv?.addEventListener("resize", sync); vv?.addEventListener("scroll", sync);
  win.addEventListener("orientationchange", delayed); editor.addEventListener("focusin", delayed); editor.addEventListener("focusout", delayed);
  const dock = editor.querySelector(".ce-dock");
  const watcher = typeof win.ResizeObserver === "function" && dock ? new win.ResizeObserver(() => editor.style.setProperty("--ce-dock-h", `${dock.offsetHeight}px`)) : null;
  watcher?.observe(dock); sync();
  return { sync, dispose() {
    vv?.removeEventListener("resize", sync); vv?.removeEventListener("scroll", sync);
    win.removeEventListener("orientationchange", delayed); editor.removeEventListener("focusin", delayed); editor.removeEventListener("focusout", delayed);
    watcher?.disconnect();
  } };
}

const TOGGLES = { source: ["source-toggle", ".ce-source"], style: ["style-toggle", "#ce-inspector"], share: ["share-toggle", ".ce-share"] };
const CHOICE_CLICK = "[data-ce-text-preset],[data-ce-photo-preset],#ce-lock,#ce-hide,#ce-forward,#ce-backward,#ce-duplicate,#ce-delete,#ce-comment-add,#ce-remove-page,#ce-split,#ce-clip-delete,#ce-depth,#ce-camera";
const OUTSIDE_SAFE = ".ce-panel,.ce-media-panel,.ce-dock,.ce-head,.ce-exit-dialog,.ce-camera-bar,.ce-crop-bar,.ce-save-bar,.ce-text-done";

// Which sheet a tool button owns, so it is not dismissed by its own click.
export function ownedSheets(button) {
  const id = button.id, d = button.dataset || {};
  if (id === "ce-source-toggle") return ["source"]; if (id === "ce-style-toggle") return ["style"];
  if (id === "ce-share-toggle") return ["share"]; if (id === "ce-layers-toggle") return ["layers"];
  if (id === "ce-draw") return ["draw"];
  if (d.ceAdd === "sticker") return ["stickers"]; if (d.ceAdd === "comment") return ["comments"];
  if (d.ceMediaTool) return ["media"];
  const open = d.ceStudioOpen;
  if (open) {
    if (open === "source") return ["source"]; if (open === "layers") return ["layers"]; if (open === "draw") return ["draw"];
    if (open === "pages") return ["pages"]; if (open === "color" || open === "crop") return ["media"];
    return ["style"];
  }
  return [];
}

export function bindSheets({ root, editor, q }) {
  const registry = createSheetRegistry(), panel = root.querySelector(".ce-panel"), media = q("media-panel");
  let pageOpen = false, dismissing = false;
  const collapse = key => { const [id, selector] = TOGGLES[key]; q(id).setAttribute("aria-expanded", "false"); root.querySelector(selector).classList.add("is-collapsed"); };
  const toggleOpen = key => q(TOGGLES[key][0]).getAttribute("aria-expanded") === "true";
  registry.register("menus", { isOpen: () => !!root.querySelector("details[open]"), close: () => root.querySelectorAll("details[open]").forEach(menu => { menu.open = false; }) });
  registry.register("draw", { isOpen: () => q("draw").getAttribute("aria-pressed") === "true", close: () => q("draw").click() });
  registry.register("media", { isOpen: () => !media.hidden, close: () => q("media-close").click() });
  for (const key of Object.keys(TOGGLES)) registry.register(key, { isOpen: () => toggleOpen(key) || (key === "style" && !q("inspector").hidden && !q("inspector").classList.contains("is-collapsed")), close: () => collapse(key) });
  registry.register("layers", { isOpen: () => panel.classList.contains("is-layers-open"), close: () => { panel.classList.remove("is-layers-open"); q("layers-toggle").setAttribute("aria-expanded", "false"); } });
  registry.register("stickers", { isOpen: () => !q("stickers").hidden, close: () => { q("stickers").hidden = true; } });
  registry.register("comments", { isOpen: () => !q("comments").hidden, close: () => { q("comments").hidden = true; } });
  registry.register("pages", { isOpen: () => pageOpen, close: () => { pageOpen = false; } });

  const syncPanel = () => {
    const wants = ["source", "style", "share", "layers", "stickers", "comments", "pages", "draw"].some(name => registry.isOpen(name));
    const show = wants && !editor.classList.contains("is-typing") && !editor.classList.contains("is-preview");
    if (panel.dataset.sheet !== (show ? "open" : "closed")) panel.dataset.sheet = show ? "open" : "closed";
    if (panel.toggleAttribute) { if (panel.hasAttribute("data-page-open") !== pageOpen) panel.toggleAttribute("data-page-open", pageOpen); }
  };
  const dismissAll = options => {
    if (dismissing) return false; dismissing = true;
    try { return registry.dismissAll(options); } finally { dismissing = false; syncPanel(); }
  };

  // Grips: handle + Done on each sheet.
  const makeHead = (sheet, label) => {
    const head = document.createElement("div"); head.className = "ce-sheet-head"; head.setAttribute("data-ce-grip", "");
    head.innerHTML = `<button type="button" class="ce-sheet-handle" aria-label="${label}"><span></span></button><button type="button" class="ce-sheet-done">Done</button>`;
    head.querySelectorAll("button").forEach(button => { button.onclick = () => dismissAll(); });
    sheet.prepend(head); sheet.classList.add("ce-sheet");
  };
  makeHead(panel, "Close tools"); makeHead(media, "Close video tool");
  media.querySelector(".ce-media-head .ce-icon-btn")?.setAttribute("data-ce-keep", "");
  // The Done button for text entry must stay reachable above the keyboard, outside the clipped stage.
  editor.append(q("text-done"));

  const bindSwipe = sheet => {
    const tracker = createSwipeTracker(); let active = false;
    const reset = () => { sheet.classList.remove("is-dragging"); sheet.style.transform = ""; };
    sheet.addEventListener("touchstart", event => {
      active = false;
      if (event.touches.length !== 1 || !canStartSwipe(event.target)) { tracker.cancel(); return; }
      const touch = event.touches[0]; tracker.start(touch.clientX, touch.clientY, { scrollTop: event.target.closest?.("[data-ce-grip]") ? 0 : sheet.scrollTop, t: event.timeStamp });
    }, { passive: true });
    sheet.addEventListener("touchmove", event => {
      const touch = event.touches[0]; if (!touch) return;
      const result = tracker.move(touch.clientX, touch.clientY);
      if (result.mode !== "drag") return;
      active = true; if (event.cancelable) event.preventDefault();
      sheet.classList.add("is-dragging"); sheet.style.transform = `translateY(${result.dy}px)`;
    }, { passive: false });
    sheet.addEventListener("touchend", event => {
      const dismiss = tracker.end(event.timeStamp);
      if (active && dismiss) { dismissAll(); requestAnimationFrame(reset); } else reset();
      active = false;
    });
    sheet.addEventListener("touchcancel", () => { tracker.cancel(); reset(); active = false; });
  };
  bindSwipe(panel); bindSwipe(media);

  // Opening a tool dismisses everything it does not own.
  root.addEventListener("click", event => {
    const button = event.target.closest?.("button,label.ce-tool,summary");
    if (!button || dismissing || button.closest(".ce-sheet-head,.ce-panel,.ce-media-panel,.ce-exit-dialog,.ce-camera-bar,.ce-crop-bar")) return;
    const isTool = button.matches("[data-ce-add],[data-ce-media-tool],[data-ce-studio-open],#ce-draw,#ce-source-toggle,#ce-style-toggle,#ce-share-toggle,#ce-layers-toggle");
    if (!isTool) return;
    if (button.dataset.ceStudioOpen === "pages") pageOpen = true;
    dismissAll({ except: ownedSheets(button) });
    if (button.dataset.ceStudioOpen === "pages") pageOpen = true;
    syncPanel();
  }, true);
  // Discrete choices close their sheet; sliders, colours and text fields stay open until Done or swipe.
  root.addEventListener("click", event => {
    if (event.target.closest?.(CHOICE_CLICK)) dismissAll({ skip: ["draw"] });
  });
  root.addEventListener("change", event => {
    const target = event.target;
    if (!target.matches?.("select,input[type=checkbox]") || !target.closest(".ce-panel,.ce-media-panel")) return;
    if (target.closest("#ce-draw-controls,.ce-share,#ce-comments,#ce-stickers")) return;
    dismissAll({ skip: ["draw"] });
  });
  // Tapping the canvas (outside every control) dismisses sheets without leaving draw mode.
  root.addEventListener("pointerdown", event => {
    if (editor.classList.contains("is-cropping") || !event.target.closest || event.target.closest(OUTSIDE_SAFE) || event.target.closest(".ce-menu-pop")) return;
    if (registry.anyOpen(["menus", "draw"])) dismissAll({ skip: ["draw"] });
  });

  const mo = new MutationObserver(syncPanel);
  mo.observe(root, { subtree: true, attributes: true, attributeFilter: ["aria-expanded", "aria-pressed", "hidden", "class"] });
  let wasTyping = false;
  const typing = new MutationObserver(() => {
    const now = editor.classList.contains("is-typing");
    if (now && !wasTyping) dismissAll({ skip: ["draw"] });
    wasTyping = now;
  });
  typing.observe(editor, { attributes: true, attributeFilter: ["class"] });
  syncPanel();
  return { dismissAll: (options = {}) => dismissAll(options), anyOpen: () => registry.anyOpen(), syncPanel,
    dispose() { mo.disconnect(); typing.disconnect(); } };
}
