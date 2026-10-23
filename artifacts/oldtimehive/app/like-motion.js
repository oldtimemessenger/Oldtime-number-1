import "./like-motion.css";
// Never touches the real state class (.on). A pending hint is cleared once the app re-renders or after a timeout,
// so a failed like rolls back to the true state instead of staying red.
const find = id => [...document.querySelectorAll("[data-like]")].filter(b => b.dataset.like === id);
let watch = null;
export function settle(id) {
  for (const b of find(id)) {
    b.classList.remove("like-pending");
    if (b.classList.contains("on")) { b.classList.add("like-pop"); setTimeout(() => b.classList.remove("like-pop"), 400); }
  }
}
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-like]"); if (!b || b.classList.contains("on")) return;
  const id = b.dataset.like; watch?.stop();
  b.classList.add("like-pending", "like-pop");
  let done = false;
  const stop = () => { done = true; obs.disconnect(); clearTimeout(timer); settle(id); };
  const obs = new MutationObserver(() => { if (!done && find(id).some(x => x.classList.contains("on") || !x.classList.contains("like-pending"))) stop(); });
  obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  const timer = setTimeout(stop, 1500);
  watch = { stop };
}, true);
