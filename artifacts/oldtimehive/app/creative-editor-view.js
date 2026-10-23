import { iconPaths } from "./icons.js";

const fallbackEsc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  text: svg('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'),
  emoji: svg('<path d="M20 12a8 8 0 11-8-8h5a3 3 0 013 3z"/><path d="M8.5 13.5a4 4 0 007 0M9 10h.01M15 10h.01"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/>'),
  draw: svg('<path d="M4 20l1-4L16 5l3 3L8 19zM13 8l3 3"/>'),
  upload: svg('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  camera: svg('<path d="M3.5 9a2.5 2.5 0 012.5-2.5h1.5L9 4.5h6l1.5 2H18A2.5 2.5 0 0120.5 9v8.5A2.5 2.5 0 0118 20H6a2.5 2.5 0 01-2.5-2.5z"/><circle cx="12" cy="13" r="3.8"/><circle cx="12" cy="13" r="1.2"/>'),
  flip: svg('<path d="M5 11a7 7 0 0112-4l2 2M19 4v5h-5M19 13a7 7 0 01-12 4l-2-2M5 20v-5h5"/>'),
  play: svg('<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  download: svg('<path d="M12 4v11M7 11l5 5 5-5M4 20h16"/>'),
  layers: svg('<rect x="8" y="3" width="13" height="13" rx="3"/><path d="M5 8a3 3 0 00-2 3v7a3 3 0 003 3h7a3 3 0 003-2"/>'),
  eye: svg('<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  undo: svg('<path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3"/>'),
  trim: svg('<rect x="7" y="4" width="10" height="16" rx="2.5"/><path d="M3 8v8M21 8v8"/>'),
  crop: svg('<path d="M7 2v13a2 2 0 002 2h13M2 7h13a2 2 0 012 2v13"/>'),
  speed: svg('<path d="M4 18a9 9 0 1116 0"/><path d="M12 18l4-6"/>'),
  color: svg('<circle cx="9" cy="9" r="5.5"/><circle cx="15" cy="9" r="5.5"/><circle cx="12" cy="15" r="5.5"/>'),
  more: svg(iconPaths.more),
  split: svg('<path d="M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M10 9.5v5l4.5-2.5z"/>'),
  sticker: svg('<path d="M20 12a8 8 0 11-8-8h5a3 3 0 013 3z"/><path d="M20 14c-3 0-5 2-5 6M8.5 13.5a4 4 0 004 1.5M9 10h.01M14 10h.01"/>'),
  frames: svg('<rect x="3" y="6" width="14" height="13" rx="3"/><path d="M8 3h10a3 3 0 013 3v10"/>'),
  spark: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/>'),
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  share: svg('<path d="M4 12v7h16v-7M12 3v12M7 8l5-5 5 5"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
};

export function renderCreativeEditor({ destination = "post", hasSource = false, esc = fallbackEsc, icons = {} } = {}) {
  const e = esc || fallbackEsc;
  const story = destination === "story";
  const community = destination === "community";
  const range = (id, label, min, max, step, val) =>
    `<label class="ce-field"${["ce-letter-spacing","ce-line-spacing","ce-background-opacity","ce-scale","ce-rotation"].includes(id) ? " data-ce-studio-only" : ""} for="${id}"><span>${e(label)}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;
  const tool = (k, label, icon) =>
    `<button type="button" class="ce-tool" data-ce-add="${k}"${["emoji","image","drawing","comment"].includes(k) ? " data-ce-studio-only" : ""} aria-label="Add ${e(label)}">${icon}<span>${e(label)}</span></button>`;
  return `<section class="creative-editor is-basic${hasSource ? " has-source" : ""}" role="dialog" aria-modal="true" aria-labelledby="ce-title" data-destination="${e(destination)}">
  <header class="ce-head">
    <button type="button" id="ce-back" class="ce-icon-btn" aria-label="Back to previous creation step"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
    <button type="button" id="ce-close" class="ce-icon-btn" aria-label="Close editor">${icons.close || I.close}</button>
    <b id="ce-title">Create</b>
    <label class="ce-workspace"><span class="ce-sr">Editing workspace</span><select id="ce-workspace" aria-label="Editing workspace"><option value="camera" selected>Camera</option><option value="studio">Oldtime Studio</option></select></label>
    <div class="ce-head-actions">
      <details class="ce-camera-settings"><summary aria-label="Camera options">${I.sliders}</summary>
      <div class="ce-camera-controls">
        <button type="button" id="ce-flash" class="ce-chip" aria-pressed="false">Flash</button>
        <label class="ce-field ce-inline" for="ce-zoom"><span>Zoom</span><input id="ce-zoom" type="range" min="1" max="4" step="0.1" value="1"></label>
        <label class="ce-field ce-inline" for="ce-camera-timer"><span>Timer</span><select id="ce-camera-timer"><option value="0">Off</option><option value="3">3s</option><option value="10">10s</option></select></label>
        <button type="button" id="ce-flip" class="ce-chip" hidden>${I.flip}<span>Flip</span></button>
      </div>
      </details>
      <details class="ce-menu ce-header-menu" name="ce-menu"><summary aria-label="Editing actions">${I.more}</summary><div class="ce-menu-pop">
      <div class="ce-save-bar"><button type="button" id="ce-save-exit" class="ce-chip">Save &amp; Exit</button><span id="ce-save-hint" class="ce-sr">Saves a draft on this device without sharing.</span></div>
      <div class="ce-theme" role="group" aria-label="Tools theme"><span class="ce-theme-label">Tools</span><button type="button" class="ce-theme-btn" data-ce-tools-theme="light" aria-pressed="false">White</button><button type="button" class="ce-theme-btn" data-ce-tools-theme="dark" aria-pressed="true">Black</button></div>
      <button type="button" id="ce-undo" class="ce-chip" aria-label="Undo">${I.undo}<span class="ce-lbl">Undo</span></button>
      <button type="button" id="ce-redo" class="ce-chip" aria-label="Redo">${I.redo}<span class="ce-lbl">Redo</span></button>
      <button data-ce-studio-only type="button" id="ce-layers-toggle" class="ce-chip" aria-expanded="false" aria-controls="ce-layer-list" aria-label="Layers">${I.layers}<span class="ce-lbl">Layers</span></button>
      <button type="button" id="ce-preview" class="ce-chip" aria-pressed="false" aria-label="Preview">${I.eye}<span class="ce-lbl">Preview</span></button>
      <button type="button" id="ce-export" class="ce-chip" aria-label="Download preview" disabled>${I.download}<span class="ce-lbl">Download</span></button>
      </div></details>
      <button type="button" id="ce-publish" class="ce-primary" disabled>Share</button>
    </div>
  </header>
  <div id="ce-exit-dialog" class="ce-exit-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ce-exit-title" aria-describedby="ce-exit-description" hidden>
    <div class="ce-exit-card"><h2 id="ce-exit-title">Save before leaving?</h2><p id="ce-exit-description">Save your edit on this device, or discard it. Nothing will be shared.</p>
      <button type="button" id="ce-exit-save" class="ce-primary">Save &amp; Exit</button>
      <button type="button" id="ce-exit-discard" class="ce-chip ce-danger">Discard edit</button>
      <button type="button" id="ce-exit-cancel" class="ce-chip">Keep editing</button>
    </div>
  </div>
  <div class="ce-body">
    <div class="ce-stage-wrap">
      <div class="ce-stage"><canvas id="ce-canvas" width="1080" height="1920" aria-label="Editing canvas"></canvas>
        <div id="ce-trash" class="ce-trash" aria-label="Drop here to delete">${I.trash}</div>
        <div id="ce-safe-guides" class="ce-safe-guides" aria-hidden="true"></div>
        <div id="ce-inline-text" class="ce-inline-text" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Text on media" spellcheck="false" hidden></div>
        <button type="button" id="ce-text-done" class="ce-primary ce-text-done" hidden>Done</button>
        <p id="ce-empty" class="ce-empty"${hasSource ? " hidden" : ""}><span class="ce-empty-mark" aria-hidden="true"></span><strong>Make this moment yours.</strong><span>Capture a photo, or choose one from your gallery.</span></p>
        <div class="ce-messages"><p id="ce-status" class="ce-status" role="status"></p>
        <p id="ce-error" class="ce-error" role="alert"></p></div>
        <div class="ce-video-context" aria-label="Quick video edits" hidden>
          <button type="button" class="ce-ctx" data-ce-quick-split aria-label="Split at playhead">${I.split}<span>Split</span></button>
          <button type="button" class="ce-ctx" data-ce-media-tool="speed" aria-label="Speed">${I.speed}<span>Speed</span></button>
          <button type="button" class="ce-ctx" data-ce-media-tool="crop" aria-label="Crop">${I.crop}<span>Crop</span></button>
        </div>
        <div id="ce-crop-overlay" class="ce-crop-overlay" hidden>
          <div class="ce-crop-bar"><button type="button" id="ce-crop-cancel" class="ce-icon-btn ce-dark" aria-label="Cancel crop" title="Cancel">${I.close}</button><b>Crop / Reframe</b><button type="button" id="ce-crop-done" class="ce-icon-btn ce-dark ce-ok" aria-label="Apply crop" title="Apply">${I.check}</button></div>
          <div class="ce-crop-tools" role="group" aria-label="Crop shape">${[["free","Free"],["1:1","1:1"],["4:5","4:5"],["9:16","9:16"],["16:9","16:9"]].map(([k,l])=>`<button type="button" class="ce-chip" data-ce-crop-ratio="${k}" aria-pressed="${k==="free"}">${l}</button>`).join("")}<button type="button" class="ce-chip" id="ce-crop-reset">Reset</button></div>
          <div id="ce-crop-box" class="ce-crop-box"><button type="button" class="ce-crop-corner" data-ce-crop-corner="nw" aria-label="Crop top left"></button><button type="button" class="ce-crop-corner" data-ce-crop-corner="ne" aria-label="Crop top right"></button><button type="button" class="ce-crop-corner" data-ce-crop-corner="sw" aria-label="Crop bottom left"></button><button type="button" class="ce-crop-corner" data-ce-crop-corner="se" aria-label="Crop bottom right"></button></div>
        </div>
      </div>
      <div class="ce-transport">
        <button type="button" id="ce-play" class="ce-icon-btn ce-dark" aria-label="Play or pause">${I.play}</button>
        <div class="ce-timeline"><div id="ce-filmstrip" class="ce-filmstrip" aria-hidden="true"></div><input id="ce-scrub" type="range" min="0" max="1" step="0.01" value="0" aria-label="Scrub timeline"><button id="ce-trim-handle-start" class="ce-trim-handle" type="button" aria-label="Drag clip start" hidden></button><button id="ce-trim-handle-end" class="ce-trim-handle" type="button" aria-label="Drag clip end" hidden></button></div>
        <span id="ce-time" class="ce-time">0:00</span>
        <div data-ce-studio-only id="ce-clip-list" class="ce-clip-list" role="list" aria-label="Clips"></div>
      </div>
    </div>
    <div id="ce-camera-bar" class="ce-camera-bar">
      <div id="ce-camera-strip" class="ce-camera-strip"></div>
      <div class="ce-capture-row">
        <span id="ce-capture-label" class="ce-capture-label" aria-live="polite">Photo</span>
        <div class="ce-capture-modes" hidden><button type="button" id="ce-photo" class="ce-camera-mode" aria-pressed="true">Photo</button>
        <button type="button" id="ce-record" class="ce-camera-mode" aria-pressed="false">Video</button></div>
        <div id="ce-camera-gallery-slot" class="ce-camera-gallery-slot"></div>
        <button type="button" id="ce-shutter" class="ce-shutter" aria-label="Take photo" disabled><span aria-hidden="true"></span></button>
      </div>
      <div id="ce-capture-picker" class="ce-capture-picker" role="tablist" aria-label="Capture mode">
        ${[["photo","Photo"],["video","Video"],["story","Story"],["carousel","Carousel"]].map(([mode,label])=>`<button type="button" role="tab" data-ce-capture-mode="${mode}" aria-selected="${mode==="photo"}">${label}</button>`).join("")}
      </div>
      <div id="ce-carousel-tray" class="ce-carousel-tray" hidden><div id="ce-carousel-shots" class="ce-carousel-shots"></div><button type="button" id="ce-carousel-next" class="ce-primary" disabled>Next (0/10)</button></div>
    </div>
    <div id="ce-media-panel" class="ce-media-panel" hidden>
      <div class="ce-media-head"><b id="ce-media-title">Trim</b><button type="button" id="ce-media-close" class="ce-icon-btn" aria-label="Close video tool">${I.close}</button></div>
      <div class="ce-media-body">
        <div data-ce-media-panel="trim" class="ce-row">
          <label class="ce-field" for="ce-trim-start"><span>Start (s)</span><input id="ce-trim-start" type="number" min="0" step="0.1" value="0"></label><label class="ce-field" for="ce-trim-end"><span>End (s)</span><input id="ce-trim-end" type="number" min="0" step="0.1" value="0"></label>
          <button type="button" id="ce-split" class="ce-chip">${I.split}<span>Split</span></button>
          <button type="button" id="ce-clip-prev" class="ce-chip">Move earlier</button>
          <button type="button" id="ce-clip-next" class="ce-chip">Move later</button>
          <button type="button" id="ce-clip-delete" class="ce-chip ce-danger">Delete clip</button>
        </div>
        <div data-ce-media-panel="speed" hidden><label class="ce-field" for="ce-speed"><span>Speed <output for="ce-speed" id="ce-speed-value">1</output></span><input id="ce-speed" type="range" min="0.25" max="2" step="0.05" value="1"></label></div>
        <div data-ce-media-panel="color" hidden><label class="ce-field" for="ce-brightness"><span>Brightness <output for="ce-brightness" id="ce-brightness-value">100</output></span><input id="ce-brightness" type="range" min="50" max="150" step="1" value="100"></label><label class="ce-field" for="ce-contrast"><span>Contrast <output for="ce-contrast" id="ce-contrast-value">100</output></span><input id="ce-contrast" type="range" min="50" max="150" step="1" value="100"></label><label class="ce-field" for="ce-saturation"><span>Saturation <output for="ce-saturation" id="ce-saturation-value">100</output></span><input id="ce-saturation" type="range" min="50" max="150" step="1" value="100"></label></div>
      </div>
    </div>
    <div class="ce-dock">
      <div class="ce-dock-row ce-main-tools" role="toolbar" aria-label="Edit tools">
        <details class="ce-menu ce-quick" name="ce-menu"><summary>${I.draw}<span>Edit</span>${I.chev}</summary>
          <div class="ce-menu-pop">
            <button type="button" class="ce-tool" data-ce-add="text" aria-label="Add Text">${I.text}<span>Text</span></button>
            <button type="button" class="ce-tool" data-ce-media-tool="crop" aria-label="Crop">${I.crop}<span>Crop</span></button>
            <button type="button" class="ce-tool" data-ce-media-tool="color" aria-label="Color">${I.color}<span>Color</span></button>
            ${tool("sticker", "Sticker", I.sticker)}
            <button type="button" id="ce-draw" class="ce-tool" aria-pressed="false">${I.draw}<span>Draw</span></button>
          </div>
        </details>
        <button data-ce-studio-only type="button" class="ce-tool" data-ce-media-tool="trim" aria-label="Trim">${I.trim}<span>Trim</span></button>
        <button data-ce-studio-only type="button" class="ce-tool" data-ce-media-tool="speed" aria-label="Speed">${I.speed}<span>Speed</span></button>
        <label for="ce-upload" class="ce-tool ce-upload-tool" data-ce-basic-only>${I.upload}<span>Upload</span></label>
        <div class="ce-more">
          <div class="ce-browser" data-ce-studio-only aria-label="Studio tools">
            <details class="ce-menu ce-browse-menu" name="ce-menu"><summary>${I.text}<span>Text</span>${I.chev}</summary><div class="ce-menu-pop ce-browse-row"><button type="button" class="ce-browse" data-ce-studio-open="text-style">${I.text}<span>Style</span></button><button type="button" class="ce-browse" data-ce-studio-open="text-presets">${I.text}<span>Presets</span></button><button type="button" class="ce-browse" data-ce-studio-open="text-animation">${I.speed}<span>Motion</span></button></div></details>
            <details class="ce-menu ce-browse-menu" name="ce-menu"><summary>${I.image}<span>Photo</span>${I.chev}</summary><div class="ce-menu-pop ce-browse-row"><button type="button" class="ce-browse" data-ce-studio-open="source">${I.upload}<span>Source</span></button><button type="button" class="ce-browse" data-ce-studio-open="color">${I.color}<span>Adjust</span></button><button type="button" class="ce-browse" data-ce-studio-open="crop">${I.crop}<span>Crop</span></button><button type="button" class="ce-browse" data-ce-studio-open="draw">${I.draw}<span>Draw</span></button></div></details>
            <details class="ce-menu ce-browse-menu" name="ce-menu"><summary>${I.layers}<span>Layers</span>${I.chev}</summary><div class="ce-menu-pop ce-browse-row"><button type="button" class="ce-browse" data-ce-studio-open="layers">${I.layers}<span>Layers</span></button><button type="button" class="ce-browse" data-ce-studio-open="order">${I.layers}<span>Order</span></button><button type="button" class="ce-browse" data-ce-studio-open="timing">${I.trim}<span>Timing</span></button><button type="button" class="ce-browse" data-ce-studio-open="blend">${I.color}<span>Blend</span></button></div></details>
            <details class="ce-menu ce-browse-menu" name="ce-menu"><summary>${I.frames}<span>Composition</span>${I.chev}</summary><div class="ce-menu-pop ce-browse-row"><button type="button" class="ce-browse" data-ce-studio-open="aspect">${I.crop}<span>Aspect</span></button><button type="button" class="ce-browse" data-ce-studio-open="pages">${I.image}<span>Pages</span></button><button type="button" class="ce-browse" data-ce-studio-open="guides">${I.eye}<span>Guides</span></button><button type="button" class="ce-browse" data-ce-studio-open="canvas-color">${I.color}<span>Canvas</span></button></div></details>
          </div>
          <details class="ce-menu ce-browse-menu" name="ce-menu" data-ce-studio-only><summary>${I.layers}<span>Add layers</span>${I.chev}</summary>
          <div class="ce-row ce-tools ce-menu-pop" role="toolbar" aria-label="Add layers">
            ${tool("emoji", "Emoji", I.emoji)}${tool("image", "Image", I.image)}${tool("drawing", "Drawing", I.draw)}${tool("comment", "Comment", I.text)}
            <input id="ce-image-upload" type="file" accept="image/*" hidden aria-label="Add image or GIF layer">
          </div>
          </details>
        </div>
        <details class="ce-menu ce-share-menu" name="ce-menu"><summary>${I.share}<span aria-label="Share options">Options</span>${I.chev}</summary>
          <div class="ce-menu-pop ce-section-pop">
        <div class="ce-section-bar"><button data-ce-studio-only type="button" id="ce-source-toggle" class="ce-chip" aria-expanded="false">Source</button><button data-ce-studio-only type="button" id="ce-style-toggle" class="ce-chip" aria-expanded="false">Style</button><button type="button" id="ce-share-toggle" class="ce-chip" aria-expanded="false">Share</button></div>
          </div>
        </details>
        <button data-ce-studio-only type="button" class="ce-tool" data-ce-media-tool="more" aria-label="More tools" aria-expanded="false">${I.more}<span>More</span></button>
      </div>
    </div>
    <div class="ce-panel" id="ce-panel">
      <div class="ce-row ce-source is-collapsed" data-ce-studio-only>
        <input id="ce-upload" type="file" accept="image/*,video/*" multiple hidden>
        <label for="ce-upload" class="ce-chip">${I.upload}<span>Background photo or video</span></label>
        <label class="ce-chip ce-canvas-color" for="ce-canvas-color"><span>Canvas color</span><input id="ce-canvas-color" type="color" value="#f2f3f5"></label>
        <button type="button" id="ce-camera" class="ce-chip">${I.camera}<span>Camera</span></button>
      </div>
      <div data-ce-studio-only id="ce-page-tools" class="ce-row" hidden><label class="ce-field">Gallery page<select id="ce-pages"></select></label><button id="ce-remove-page" type="button" class="ce-chip">Remove page</button></div>
      <div class="ce-group ce-canvas-opts" data-ce-studio-only>
        <label class="ce-field" for="ce-aspect"><span>Aspect</span><select id="ce-aspect"><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="4:5">4:5</option><option value="16:9">16:9</option></select></label>
        <label class="ce-check" for="ce-safe"><input id="ce-safe" type="checkbox" checked><span>Safe guides</span></label>
        <label class="ce-check" for="ce-allow-outside"><input id="ce-allow-outside" type="checkbox"><span>Allow outside bounds</span></label>
      </div>
      <div id="ce-stickers" class="ce-group ce-sticker-picker" hidden>
        <div id="ce-sticker-flow" class="ce-sticker-flow">
          <section id="ce-sticker-library" class="ce-sticker-page" aria-label="Sticker library">
            <div class="ce-sticker-intro"><strong>Stickers</strong><span>Choose one to place it on your media</span></div>
            <label class="ce-sticker-search" for="ce-sticker-search"><span class="ce-sticker-search-icon" aria-hidden="true"></span><input id="ce-sticker-search" type="search" maxlength="50" placeholder="Find a sticker" autocomplete="off"></label>
            <div id="ce-sticker-categories" class="ce-sticker-categories" role="tablist" aria-label="Sticker categories">
              <button type="button" role="tab" aria-selected="true" data-ce-sticker-category="all">All</button>
              <button type="button" role="tab" aria-selected="false" data-ce-sticker-category="interactive">Interactive</button>
              <button type="button" role="tab" aria-selected="false" data-ce-sticker-category="community">Community</button>
              <button type="button" role="tab" aria-selected="false" data-ce-sticker-category="emoji">Emoji</button>
              <button type="button" role="tab" aria-selected="false" data-ce-sticker-category="marks">Marks</button>
            </div>
            <div id="ce-sticker-track" class="ce-sticker-track" role="group" aria-label="Available stickers">
              <button type="button" class="ce-sticker-card" data-ce-sticker="reaction" data-ce-sticker-group="community" data-ce-sticker-name="reaction">
                <span class="ce-sticker-art ce-sticker-reaction" aria-hidden="true"><span>WOW</span></span><span>Reaction</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="emoji" data-ce-sticker-group="emoji" data-ce-sticker-name="emoji expression">
                <span class="ce-sticker-art ce-sticker-emoji" aria-hidden="true">♥</span><span>Emoji</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="location" data-ce-sticker-group="community" data-ce-sticker-name="place location">
                <span class="ce-sticker-art ce-sticker-place" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 28s10-10.1 10-17a10 10 0 1 0-20 0c0 6.9 10 17 10 17Z"/><circle cx="16" cy="11" r="3.2"/></svg></span><span>Place</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="mention" data-ce-sticker-group="community" data-ce-sticker-name="mention handle">
                <span class="ce-sticker-art ce-sticker-handle" aria-hidden="true">@</span><span>Handle</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="hashtag" data-ce-sticker-group="community" data-ce-sticker-name="hashtag topic">
                <span class="ce-sticker-art ce-sticker-topic" aria-hidden="true">#</span><span>Topic</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="music" data-ce-sticker-group="community" data-ce-sticker-name="audio music">
                <span class="ce-sticker-art ce-sticker-audio" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M12 23V8l12-3v15"/><circle cx="8" cy="23" r="4"/><circle cx="20" cy="20" r="4"/></svg></span><span>Audio label</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="question" data-ce-sticker-group="interactive" data-ce-sticker-name="question ask">
                <span class="ce-sticker-art ce-sticker-question" aria-hidden="true"><b>Ask</b><i></i></span><span>Question</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="poll" data-ce-sticker-group="interactive" data-ce-sticker-name="poll vote">
                <span class="ce-sticker-art ce-sticker-poll" aria-hidden="true"><i></i><i></i></span><span>Poll</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="hey-word" data-ce-sticker-group="interactive" data-ce-sticker-name="hey word prompt" data-ce-story-only>
                <span class="ce-sticker-art ce-sticker-hey-word" aria-hidden="true"><b>OLDTIME</b><span>Your turn</span></span><span>Hey Word</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="heart" data-ce-sticker-group="marks" data-ce-sticker-name="heart">
                <span class="ce-sticker-art ce-sticker-heart" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 42 7 26C-5 10 13 1 24 14 35 1 53 10 41 26Z"/></svg></span><span>Heart</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="arrow" data-ce-sticker-group="marks" data-ce-sticker-name="arrow">
                <span class="ce-sticker-art ce-sticker-arrow" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M7 24h32M26 10l14 14-14 14"/></svg></span><span>Arrow</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="circle" data-ce-sticker-group="marks" data-ce-sticker-name="circle">
                <span class="ce-sticker-art ce-sticker-circle" aria-hidden="true"></span><span>Circle</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="rectangle" data-ce-sticker-group="marks" data-ce-sticker-name="frame rectangle">
                <span class="ce-sticker-art ce-sticker-frame" aria-hidden="true"></span><span>Frame</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="star" data-ce-sticker-group="marks" data-ce-sticker-name="star">
                <span class="ce-sticker-art ce-sticker-star" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="m24 4 5.8 12.1L43 18l-9.5 9.2L35.8 41 24 34.7 12.2 41l2.3-13.8L5 18l13.2-1.9Z"/></svg></span><span>Star</span>
              </button>
              <button type="button" class="ce-sticker-card" data-ce-sticker="custom-text" data-ce-sticker-group="marks" data-ce-sticker-name="custom text words">
                <span class="ce-sticker-art ce-sticker-custom-text" aria-hidden="true">Aa</span><span>Text</span>
              </button>
            </div>
            <p id="ce-sticker-empty" class="ce-sticker-empty" hidden>No stickers match that search.</p>
            <p class="ce-sticker-tip">Swipe to browse · Drag to move after placing</p>
          </section>
          <section id="ce-sticker-config-page" class="ce-sticker-page ce-sticker-config-page" aria-label="Edit sticker">
            <div class="ce-sticker-config-head"><button type="button" id="ce-sticker-back" class="ce-sticker-back"><span aria-hidden="true">←</span><span>Stickers</span></button><strong id="ce-sticker-config-title">Edit sticker</strong><span class="ce-sticker-step">EDIT</span></div>
            <div id="ce-sticker-config-preview" class="ce-sticker-config-preview" aria-live="polite"></div>
            <div class="ce-sticker-colors">
              <label class="ce-color-choice" for="ce-sticker-accent"><span>Accent</span><input id="ce-sticker-accent" type="color" value="#e5262f"></label>
              <label class="ce-color-choice" for="ce-sticker-surface"><span>Surface</span><input id="ce-sticker-surface" type="color" value="#f4f1ec"></label>
            </div>
            <input id="ce-sticker-kind" type="hidden" value="">
            <label id="ce-sticker-value-wrap" class="ce-field" for="ce-sticker-value"><span id="ce-sticker-value-label">Sticker text</span><input id="ce-sticker-value" type="text" maxlength="120" autocomplete="off"></label>
            <label id="ce-sticker-options-wrap" class="ce-field" for="ce-sticker-options" hidden><span>Poll answers</span><input id="ce-sticker-options" type="text" placeholder="Yes, No" maxlength="80" autocomplete="off"></label>
            <p id="ce-sticker-config-help" class="ce-sub"></p>
            <div id="ce-hey-word-controls" class="ce-group ce-hey-word-config" hidden>
              <label class="ce-check" for="ce-hey-word-enabled"><input id="ce-hey-word-enabled" type="checkbox"><span>Make this an Oldtime story prompt</span></label>
              <label id="ce-hey-word-field" class="ce-field" for="ce-hey-word-prompt" hidden><span>Prompt</span><input id="ce-hey-word-prompt" type="text" maxlength="120" placeholder="Invite people to share their take"></label>
              <p id="ce-hey-word-note" class="ce-sub">People can answer with their own Oldtime story.</p>
            </div>
            <div class="ce-sticker-config-actions"><button type="button" id="ce-sticker-add" class="ce-chip">Place sticker</button></div>
          </section>
        </div>
      </div>
      <div id="ce-comments" class="ce-group" hidden>
        <label class="ce-field" for="ce-comment-select"><span>Comment</span><select id="ce-comment-select"></select></label>
        <button type="button" id="ce-comment-add" class="ce-chip">Add comment</button>
      </div>
      <div id="ce-draw-controls" class="ce-group ce-draw-controls">
        <label class="ce-field" for="ce-brush"><span>Brush</span><select id="ce-brush"><option value="pen">Pen</option><option value="marker">Marker</option><option value="highlighter">Highlighter</option><option value="eraser">Eraser</option><option value="handwriting">Handwriting</option></select></label>
        ${range("ce-draw-opacity", "Brush opacity", 0.1, 1, 0.05, 1)}
        <label class="ce-field ce-color-field" for="ce-draw-color"><span>Brush color</span><input id="ce-draw-color" type="color" value="#e0245e"></label>
        ${range("ce-draw-width", "Brush width", 2, 80, 1, 12)}
      </div>
      <div id="ce-layer-list" class="ce-layer-list" role="listbox" aria-label="Layers"></div>
      <div id="ce-inspector" class="ce-inspector is-collapsed" hidden>
        <div id="ce-sticker-edit-fields" class="ce-group ce-sticker-edit-fields" hidden>
          <label class="ce-field" for="ce-sticker-edit-text"><span>Sticker text</span><textarea id="ce-sticker-edit-text" rows="2" maxlength="160"></textarea></label>
          <div id="ce-sticker-edit-poll" class="ce-sticker-edit-poll" hidden>
            <label class="ce-field" for="ce-sticker-edit-choice-a"><span>Answer 1</span><input id="ce-sticker-edit-choice-a" type="text" maxlength="40"></label>
            <label class="ce-field" for="ce-sticker-edit-choice-b"><span>Answer 2</span><input id="ce-sticker-edit-choice-b" type="text" maxlength="40"></label>
          </div>
          <div class="ce-sticker-colors">
            <label class="ce-color-choice" for="ce-sticker-edit-accent"><span>Accent</span><input id="ce-sticker-edit-accent" type="color" value="#e5262f"></label>
            <label class="ce-color-choice" for="ce-sticker-edit-surface"><span>Surface</span><input id="ce-sticker-edit-surface" type="color" value="#f4f1ec"></label>
          </div>
          <p id="ce-sticker-edit-help" class="ce-sub" aria-live="polite"></p>
        </div>
        <div id="ce-text-fields" class="ce-text-fields ce-group">
          <label class="ce-field" for="ce-text"><span>Text</span><textarea id="ce-text" rows="2"></textarea></label>
          <label class="ce-field" for="ce-font"><span>Font</span><select id="ce-font"><option value="Manrope">Manrope</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option><option value="system-ui">System</option></select></label>
          <label class="ce-field" for="ce-align"><span>Alignment</span><select id="ce-align"><option value="left">Left</option><option value="center" selected>Center</option><option value="right">Right</option></select></label>
          <label class="ce-field ce-color-field" for="ce-color"><span>Text color</span><input id="ce-color" type="color" value="#ffffff"></label>
          <label class="ce-field ce-color-field" for="ce-background"><span>Background</span><input id="ce-background" type="color" value="#000000"></label>
          <label class="ce-check" for="ce-background-on"><input id="ce-background-on" type="checkbox"><span>Text background (optional)</span></label>
          ${range("ce-font-size", "Font size", 16, 180, 1, 64)}
          <label class="ce-field" for="ce-text-width"><span>Text width</span><input id="ce-text-width" type="range" min=".08" max="1" step=".01" value=".7" aria-label="Text box width as a fraction of project width"></label>
          <div class="ce-presets" data-ce-studio-only role="group" aria-label="Text style presets">
            <p class="ce-sub">Text styles</p>
            <div class="ce-preset-grid"><button type="button" class="ce-preset" data-ce-text-preset="plain" data-preset="plain" aria-label="Plain text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Plain</span></button><button type="button" class="ce-preset" data-ce-text-preset="editorial" data-preset="editorial" aria-label="Editorial text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Editorial</span></button><button type="button" class="ce-preset" data-ce-text-preset="neon" data-preset="neon" aria-label="Neon text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Neon</span></button><button type="button" class="ce-preset" data-ce-text-preset="outline" data-preset="outline" aria-label="Outline text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Outline</span></button><button type="button" class="ce-preset" data-ce-text-preset="echo" data-preset="echo" aria-label="Echo text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Echo</span></button><button type="button" class="ce-preset" data-ce-text-preset="chrome" data-preset="chrome" aria-label="Chrome text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Chrome</span></button><button type="button" class="ce-preset" data-ce-text-preset="gold" data-preset="gold" aria-label="Gold text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Gold</span></button><button type="button" class="ce-preset" data-ce-text-preset="extruded" data-preset="extruded" aria-label="Extruded text style"><span class="ce-preset-aa" aria-hidden="true">Aa</span><span class="ce-preset-name">Extruded</span></button></div>
            ${range("ce-effect-strength", "Effect strength", 0, 100, 1, 60)}
            <label class="ce-field ce-color-field" for="ce-effect-color"><span>Effect color</span><input id="ce-effect-color" type="color" value="#b51e29"></label>
          </div>
          <div class="ce-row"><label class="ce-check" for="ce-bold"><input id="ce-bold" type="checkbox"><span>Bold</span></label><label class="ce-check" for="ce-italic"><input id="ce-italic" type="checkbox"><span>Italic</span></label><label class="ce-check" for="ce-shadow"><input id="ce-shadow" type="checkbox"><span>Shadow</span></label><label class="ce-check" for="ce-outline"><input id="ce-outline" type="checkbox"><span>Outline</span></label></div>
          ${range("ce-background-opacity", "Background opacity", 0, 1, 0.05, 1)}
          ${range("ce-letter-spacing", "Letter spacing", -4, 20, 0.5, 0)}
          ${range("ce-line-spacing", "Line spacing", 0.9, 2, 0.05, 1.2)}
          <label class="ce-field" data-ce-studio-only for="ce-case"><span>Case</span><select id="ce-case"><option value="none">None</option><option value="uppercase">Uppercase</option><option value="lowercase">Lowercase</option></select></label>
          <label class="ce-field" data-ce-studio-only for="ce-bubble"><span>Bubble</span><select id="ce-bubble"><option value="rounded">Rounded</option><option value="pill">Pill</option><option value="square">Square</option><option value="none">None</option></select></label>
          <label class="ce-field" data-ce-studio-only for="ce-animation"><span>Animation</span><select id="ce-animation"><option value="none">None</option><option value="fade">Fade</option><option value="pop">Pop</option><option value="slide">Slide</option></select></label>
        </div>
        <div class="ce-group">
          ${range("ce-opacity", "Opacity", 0, 1, 0.05, 1)}
          <label class="ce-field" data-ce-studio-only for="ce-blend"><span>Blend</span><select id="ce-blend"><option value="source-over">Normal</option><option value="multiply">Multiply</option><option value="screen">Screen</option><option value="overlay">Overlay</option><option value="soft-light">Soft light</option><option value="hard-light">Hard light</option><option value="darken">Darken</option><option value="lighten">Lighten</option><option value="color-dodge">Color dodge</option><option value="color-burn">Color burn</option><option value="difference">Difference</option><option value="exclusion">Exclusion</option><option value="hue">Hue</option><option value="saturation">Saturation</option><option value="color">Color</option><option value="luminosity">Luminosity</option></select></label>
          ${range("ce-scale", "Scale", 0.08, 3, 0.01, 1)}
          ${range("ce-rotation", "Rotation", -180, 180, 1, 0)}
        </div>
        <div data-ce-studio-only id="ce-timing" class="ce-group ce-timing ce-row">
          <div class="ce-handles"><label class="ce-field" for="ce-overlay-start"><span>In</span><input id="ce-overlay-start" type="range" min="0" max="1" step="0.01" value="0"></label><label class="ce-field" for="ce-overlay-end"><span>Out</span><input id="ce-overlay-end" type="range" min="0" max="1" step="0.01" value="1"></label><p id="ce-timeline-summary" class="ce-status"></p></div>
          <label class="ce-field" for="ce-start"><span>Start (s)</span><input id="ce-start" type="number" min="0" step="0.1" value="0"></label>
          <label class="ce-field" for="ce-end"><span>End (s)</span><input id="ce-end" type="number" min="0" step="0.1"></label>
        </div>
        <div class="ce-row ce-actions">
          <button type="button" id="ce-lock" class="ce-chip" aria-pressed="false">Lock</button>
          <button type="button" id="ce-hide" class="ce-chip" aria-pressed="false">Hide</button>
          <button type="button" data-ce-studio-only id="ce-backward" class="ce-chip">Send back</button>
          <button type="button" data-ce-studio-only id="ce-forward" class="ce-chip">Bring forward</button>
          <button type="button" data-ce-studio-only id="ce-duplicate" class="ce-chip">Duplicate</button>
          <button type="button" id="ce-delete" class="ce-chip ce-danger">Delete</button>
        </div>
      </div>
      <div class="ce-group ce-share is-collapsed">
        <label class="ce-field" for="ce-destination"><span>Share to</span><select id="ce-destination"><option value="post"${!story && !community ? " selected" : ""}>Main feed</option><option value="community"${community ? " selected" : ""}>Community</option><option value="story"${story ? " selected" : ""}>Story</option></select></label>
        <label class="ce-share-crosspost" id="ce-other-feed-field"><input id="ce-other-feed" type="checkbox"><span id="ce-other-feed-label">${community ? "Also share to Main feed" : "Also share to Community"}</span></label>
        <label class="ce-field" for="ce-location"><span>Location</span><input id="ce-location" type="text" maxlength="80" placeholder="Add location"></label>
        <label class="ce-field" for="ce-caption"><span>Caption</span><textarea id="ce-caption" rows="2" maxlength="2200" placeholder="Write a caption"></textarea></label>
          <label class="ce-field" for="ce-visibility"><span>Visibility</span><select id="ce-visibility"><option value="public">Public</option><option value="followers">Followers</option><option value="friends">Friends</option><option value="close-friends">Close friends</option></select></label>
      </div>
    </div>
  </div>
</section>`;
}
