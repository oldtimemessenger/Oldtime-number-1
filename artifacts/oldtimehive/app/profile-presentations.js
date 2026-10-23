/**
 * Isolated, data-only profile presentations for Albums, Memories, and Quotes.
 * Callers own routing, playback state, and event delegation.
 */

const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

const safeUrl = value => {
  const url = String(value ?? "").trim();
  return /^(https?:|data:image\/)/i.test(url) ? url : "";
};
const localMedia = value => /^oldtime-media:[\w-]+$/i.test(String(value ?? ""));
const imageSource = value => localMedia(value)
  ? `data-local-media="${escapeHTML(value)}"`
  : `src="${escapeHTML(safeUrl(value))}"`;

const mediaMarkup = item => {
  const src = safeUrl(item?.media);
  const local = /^oldtime-media:[\w-]+$/i.test(String(item?.media || ""));
  if (!src && !local) return `<div class="ot-media-placeholder" aria-label="Media unavailable"></div>`;
  const source = local ? `data-local-media="${escapeHTML(item.media)}"` : `src="${escapeHTML(src)}"`;
  const position = item.position && typeof item.position === "object" ? item.position : {};
  const x = Math.max(0, Math.min(100, Number(position.x) || 50));
  const y = Math.max(0, Math.min(100, Number(position.y) || 50));
  const zoom = Math.max(1, Math.min(2, Number(position.zoom) || 1));
  const cropStyle = `object-position:${x}% ${y}%;transform:scale(${zoom})`;
  return item.mediaType === "video"
    ? `<video ${source} muted playsinline preload="metadata" aria-label="${escapeHTML(item.caption || "Collection media")}" style="${cropStyle}"></video>`
    : `<img ${source} alt="" loading="lazy" style="${cropStyle}">`;
};

const coverTemplateMarkup = (template, title) => {
  const name = template === "red" ? "red" : template === "night" ? "night" : "mono";
  const label = name === "red" ? "OLDTIME" : name === "night" ? "MEMORIES" : "ALBUM";
  return `<span class="ot-profile-cover-template is-${name}" aria-label="${escapeHTML(title || "Collection")} cover"><b>${escapeHTML(title || "Your collection")}</b><small>${label}</small></span>`;
};

const dateLabel = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric",
  }).format(date);
};

/**
 * Horizontal, independently scrollable quote shelf. Quote buttons dispatch
 * through data-quote-open; the app can pass the selected id into #storyview.
 * @param {Array<object>} quotes
 * @param {{label?: string, canDelete?: boolean}} options
 */
export function renderQuoteStrip(quotes = [], options = {}) {
  const list = Array.isArray(quotes) ? quotes : [];
  const label = escapeHTML(options.label || "Quotes");
  return `
    <section class="ot-profile-shelf ot-quote-shelf" aria-label="${label}" data-testid="quote-strip">
      <div class="ot-shelf-heading">
        <div><h2>${label}</h2><p>Words worth keeping</p></div>
        <span class="ot-shelf-count">${list.length}</span>
      </div>
      ${list.length ? `<div class="ot-quote-track" role="list" aria-label="${label}, swipe to browse">
        ${list.map((quote, index) => {
          const id = escapeHTML(quote.id);
          const photo = safeUrl(quote.media?.[0]) || (localMedia(quote.media?.[0]) ? quote.media[0] : "");
          const byline = [quote.author, dateLabel(quote.created)].filter(Boolean).map(escapeHTML).join(" · ");
          const quoteText = String(quote.text || "");
          const isLong = quoteText.length > 150;
          return `<article class="ot-quote-card${photo ? " has-photo" : ""}" role="listitem"
            data-testid="quote-card-${id}">
             ${photo ? `<img class="ot-quote-card-photo" ${imageSource(photo)} alt="" loading="lazy">` : ""}
            <span class="ot-quote-card-content">
              <span class="ot-quote-mark" aria-hidden="true">“</span>
               <button type="button" class="ot-quote-open" data-quote-open="${id}" data-quote-index="${index}"
                 aria-label="Open quote ${index + 1}${quote.author ? ` by ${escapeHTML(quote.author)}` : ""}">
                 ${isLong ? `<span class="ot-quote-text ot-quote-clamp">${escapeHTML(quoteText)}</span>` : `<span class="ot-quote-text">${escapeHTML(quoteText)}</span>`}
               </button>
               ${isLong ? `<details class="ot-quote-more"><summary>See more</summary><span>${escapeHTML(quoteText)}</span></details>` : ""}
               ${quote.caption ? (String(quote.caption).length > 90
                 ? `<details class="ot-quote-caption-more"><summary><span class="ot-quote-caption">${escapeHTML(quote.caption)}</span><b>See more</b></summary><span>${escapeHTML(quote.caption)}</span></details>`
                 : `<span class="ot-quote-caption">${escapeHTML(quote.caption)}</span>`) : ""}
              <span class="ot-quote-byline">${byline || "A saved thought"}</span>
            </span>
             <span class="ot-quote-open-hint" aria-hidden="true">Open quote</span>
             ${quote.id ? `<div class="ot-quote-actions" aria-label="Quote actions">
               <button type="button" data-quote-like="${id}" aria-label="${quote.liked ? "Unlike" : "Like"} quote" aria-pressed="${quote.liked === true}">${quote.icons?.heart || "Like"}<span>${escapeHTML(quote.likes ?? 0)}</span></button>
               <button type="button" data-quote-comments="${id}" aria-label="Open quote comments">${quote.icons?.comment || "Reply"}<span>${escapeHTML(quote.comments ?? 0)}</span></button>
               <button type="button" data-quote-repost="${id}" aria-label="Repost quote">${quote.icons?.repost || "Repost"}<span>${escapeHTML(quote.reposts ?? 0)}</span></button>
               <button type="button" data-quote-share="${id}" aria-label="Share quote">${quote.icons?.share || "Share"}</button>
                ${options.canDelete ? `<button type="button" class="ot-quote-delete-action" data-delete-post="${id}" aria-label="Delete your quote" title="Delete quote">${quote.icons?.trash || "Delete"}</button>` : ""}
             </div>` : ""}
           </article>`;
        }).join("")}
      </div>` : `<div class="ot-shelf-empty" data-testid="quotes-empty"><b>No quotes yet</b><span>Keep a line that stays with you.</span></div>`}
    </section>`;
}

/**
 * Collection shelf with optional selected-collection media grid.
 * Events: data-collection-open and data-collection-close; collection creation
 * can be wired by the host via data-collection-create.
 * @param {Array<object>} collections
 * @param {{selectedId?: string|number|null, showCreate?: boolean}} options
 */
export function renderCollectionShelf(collections = [], options = {}) {
  const list = Array.isArray(collections) ? collections : [];
  const selected = list.find(item => String(item.id) === String(options.selectedId));
  const heading = selected ? selected.title : "Albums & Memories";
  const typeName = type => type === "memory" ? "Memory" : "Album";

  if (selected) {
    const items = Array.isArray(selected.items) ? selected.items : [];
    return `
      <section class="ot-profile-shelf ot-collection-view" aria-label="${escapeHTML(heading)}" data-testid="collection-grid">
        <header class="ot-collection-header">
          <button type="button" class="ot-back-button" data-collection-close aria-label="Back to profile collections" data-testid="collection-back">
            <span aria-hidden="true">←</span><span>Collections</span>
          </button>
          ${options.canDelete ? `<button type="button" class="ot-delete-collection" data-collection-delete="${escapeHTML(selected.id)}" aria-label="Delete collection">Delete</button>` : ""}
          <div class="ot-collection-title-row">
            <div><p class="ot-eyebrow">${typeName(selected.type)}${dateLabel(selected.createdAt) ? ` · ${escapeHTML(dateLabel(selected.createdAt))}` : ""}</p>
              <h2>${escapeHTML(selected.title || typeName(selected.type))}</h2></div>
            <span class="ot-item-count">${items.length} ${items.length === 1 ? "item" : "items"}</span>
          </div>
           ${selected.coverUri ? `<div class="ot-collection-detail-cover" role="img" aria-label="${escapeHTML(selected.title)} cover">${mediaMarkup({ media: selected.coverUri, caption: `${selected.title} cover`, position: selected.coverPosition })}</div>`
            : selected.coverTemplate ? `<div class="ot-collection-detail-cover">${coverTemplateMarkup(selected.coverTemplate, selected.title)}</div>` : ""}
          ${selected.description ? `<p class="ot-collection-description">${escapeHTML(selected.description)}</p>` : ""}
        </header>
        ${items.length ? `<div class="ot-collection-grid" role="list" aria-label="Recent media in ${escapeHTML(selected.title)}">
          ${items.map((item, index) => `<button type="button" class="ot-collection-tile" role="listitem"
            data-collection-item="${escapeHTML(item.id)}" data-collection-id="${escapeHTML(selected.id)}"
             data-post-id="${escapeHTML(item.postId || "")}" data-media-index="${escapeHTML(item.mediaIndex ?? "")}"
            data-testid="collection-item-${escapeHTML(item.id)}" aria-label="Open item ${index + 1}${item.caption ? `: ${escapeHTML(item.caption)}` : ""}">
            ${mediaMarkup(item)}
            ${item.caption ? `<span class="ot-tile-caption">${escapeHTML(item.caption)}</span>` : ""}
          </button>`).join("")}
        </div>` : `<div class="ot-shelf-empty ot-grid-empty" data-testid="collection-empty"><b>This collection is ready for a first moment</b><span>Add photos or videos to bring it to life.</span></div>`}
      </section>`;
  }

  return `
    <section class="ot-profile-shelf ot-collections-shelf" aria-label="Albums and Memories" data-testid="collection-shelf">
      <div class="ot-shelf-heading">
        <div><h2>Albums &amp; Memories</h2><p>Little chapters from real life</p></div>
        ${options.showCreate ? `<button type="button" class="ot-create-collection" data-collection-create data-testid="collection-create">Create</button>` : ""}
      </div>
      ${list.length ? `<div class="ot-collection-list" role="list">
        ${list.map(collection => {
          const items = Array.isArray(collection.items) ? collection.items : [];
          const cover = items.find(item => safeUrl(item.media));
          const id = escapeHTML(collection.id);
          const coverMarkup = collection.coverUri
            ? mediaMarkup({ media: collection.coverUri, caption: `${collection.title} cover`, position: collection.coverPosition })
            : collection.coverTemplate
              ? coverTemplateMarkup(collection.coverTemplate, collection.title)
              : cover ? mediaMarkup(cover) : `<span class="ot-cover-initial" aria-hidden="true">${escapeHTML((collection.title || typeName(collection.type)).slice(0, 1).toUpperCase())}</span>`;
          return `<button type="button" class="ot-collection-card" role="listitem" data-collection-open="${id}"
              data-testid="collection-card-${id}" aria-label="Open ${typeName(collection.type)} ${escapeHTML(collection.title)}">
             <span class="ot-collection-cover" role="img" aria-label="${escapeHTML(collection.title)} cover">${coverMarkup}
              <span class="ot-cover-count">${items.length}</span></span>
            <span class="ot-collection-meta"><span class="ot-eyebrow">${typeName(collection.type)}${dateLabel(collection.createdAt) ? ` · ${escapeHTML(dateLabel(collection.createdAt))}` : ""}</span>
              <b>${escapeHTML(collection.title || typeName(collection.type))}</b>
              ${collection.description ? `<span class="ot-collection-summary">${escapeHTML(collection.description)}</span>` : `<span class="ot-collection-summary">${items.length} ${items.length === 1 ? "moment" : "moments"}</span>`}</span>
            <span class="ot-collection-chevron" aria-hidden="true">›</span>
          </button>`;
        }).join("")}
      </div>` : `<div class="ot-shelf-empty" data-testid="collections-empty"><b>Your stories, gathered</b><span>Create an Album or Memory to keep photos and their context together.</span>
        ${options.showCreate ? `<button type="button" class="ot-create-collection ot-empty-create" data-collection-create>Create a collection</button>` : ""}</div>`}
    </section>`;
}

/**
 * Full-viewport authored quote viewer markup for mounting in #storyview.
 * Events: data-quote-close, data-quote-prev, data-quote-next. The host owns
 * the active index and should render again when it changes.
 * @param {Array<object>} quotes
 * @param {number} activeIndex
 * @param {{profileLabel?: string, canDelete?: boolean}} options
 */
export function renderQuoteViewer(quotes = [], activeIndex = 0, options = {}) {
  const list = Array.isArray(quotes) ? quotes : [];
  if (!list.length) return "";
  const index = Math.max(0, Math.min(Number(activeIndex) || 0, list.length - 1));
  const quote = list[index];
  const image = safeUrl(quote.media?.[0]) || (localMedia(quote.media?.[0]) ? quote.media[0] : "");
  const author = escapeHTML(quote.author || options.profileLabel || "A thought");
  const avatar = safeUrl(quote.authorPhoto);
  const date = dateLabel(quote.created);
  return `
    <section class="ot-quote-viewer" role="dialog" aria-modal="true" aria-label="Quote ${index + 1} of ${list.length}"
      data-testid="quote-viewer" data-quote-viewer data-quote-index="${index}" tabindex="-1">
      <header class="ot-viewer-top">
        <button type="button" class="ot-viewer-exit" data-quote-close data-testid="quote-viewer-exit" aria-label="Close quote and return to profile">
          <span aria-hidden="true">×</span><span>Profile</span>
        </button>
        <span class="ot-viewer-count">${index + 1} <span aria-hidden="true">/</span> ${list.length}</span>
      </header>
      <div class="ot-viewer-stage" data-quote-swipe>
        <article class="ot-authored-quote${image ? " has-image" : ""}" data-testid="quote-snapshot">
          ${image ? `<img class="ot-authored-quote-photo" ${imageSource(image)} alt="">` : ""}
          <div class="ot-authored-quote-body">
            <div class="ot-authored-byline"><span class="ot-author-monogram" aria-hidden="true">${avatar ? `<img src="${escapeHTML(avatar)}" alt="">` : escapeHTML(author.slice(0, 1).toUpperCase())}</span>
              <span><b>${author}</b>${date ? `<small>${escapeHTML(date)}</small>` : ""}</span><span class="ot-authored-label">QUOTE</span></div>
            <blockquote>${escapeHTML(quote.text)}</blockquote>
            ${quote.caption ? `<p class="ot-authored-caption">${escapeHTML(quote.caption)}</p>` : ""}
            <div class="ot-authored-footer"><span>Saved to profile</span><span>${index + 1} of ${list.length}</span></div>
          </div>
        </article>
        <span class="ot-viewer-swipe-hint" aria-hidden="true">Swipe up or down to browse</span>
      </div>
      <nav class="ot-viewer-controls" aria-label="Quote navigation">
        <button type="button" data-quote-prev aria-label="Previous quote" ${index === 0 ? "disabled" : ""}>Previous</button>
        <div class="ot-viewer-dots" aria-hidden="true">${list.map((_, i) => `<i class="${i === index ? "is-current" : ""}"></i>`).join("")}</div>
        <button type="button" data-quote-next aria-label="Next quote" ${index === list.length - 1 ? "disabled" : ""}>Next</button>
      </nav>
        ${quote.id ? `<div class="ot-quote-viewer-actions">
          <button type="button" class="ot-quote-share" data-quote-share="${escapeHTML(quote.id)}" aria-label="Share this quote card">Share quote card</button>
          ${options.canDelete ? `<button type="button" class="ot-quote-delete" data-delete-post="${escapeHTML(quote.id)}" aria-label="Delete your quote">Delete</button>` : ""}
        </div>` : ""}
    </section>`;
}
