import "./help-prompt-view.css";

const ART = ["membership","welcome","blast","friends","note","cover","privacy","messages","communities","saved","notifications","safety","studio"];

function artFile(a) {
  const name = String(a?.image || "").replace(/\.webp$/i, "");
  if (ART.includes(name)) return `${name}.webp`;
  const hint = `${a?.category || ""} ${a?.id || ""}`;
  return !a?.local && /membership|blue-?badge/i.test(hint) ? "membership.webp" : "welcome.webp";
}

export function renderPromptCard(a, { esc, id, baseUrl = "" } = {}) {
  const src = `${baseUrl}guide/${artFile(a)}`;
  const secondary = a.secondaryRoute
    ? `<button type="button" class="cta-secondary" data-cta="secondary-action">${esc(a.secondaryLabel || "More")}</button>` : "";
  const primary = a.primaryRoute
    ? `<button type="button" class="cta-primary" data-cta="action">${esc(a.primaryLabel || "Learn more")}</button>` : "";
  return `<section class="cta-modal hp-card" role="${a.local && !a.manual ? "region" : "dialog"}" ${a.local && !a.manual ? "" : 'aria-modal="true"'} aria-labelledby="${id}-t" aria-describedby="${id}-d" tabindex="-1">
    <div class="cta-top"><span class="cta-eyebrow">${esc(a.category || "Oldtime")}</span><button type="button" class="cta-x" data-cta="not-now" aria-label="Close">&times;</button></div>
    <div class="hp-art"><img src="${esc(src)}" alt="" width="320" height="160" decoding="async"></div>
    <h2 id="${id}-t">${esc(a.title)}</h2><p id="${id}-d">${esc(a.description || "")}</p>
    <div class="cta-err" role="alert" aria-live="assertive"></div>
    <div class="cta-actions">${primary}${secondary}
    <button type="button" class="cta-secondary" data-cta="not-now">Maybe later</button>
    <button type="button" class="cta-link" data-cta="never">Don't show again</button></div></section>`;
}
