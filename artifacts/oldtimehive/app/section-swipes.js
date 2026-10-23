export const MAIN_SECTIONS = ["updates", "blast", "communities", "chat", "profile"];

export function nextSection(current, dx, dy, elapsed = 0, sections = MAIN_SECTIONS) {
  const index = sections.indexOf(current);
  if (index < 0 || elapsed > 900 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.7) return null;
  return sections[index + (dx < 0 ? 1 : -1)] || null;
}

export function ownsHorizontalGesture(target, root, style = globalThis.getComputedStyle) {
  if (!target?.closest || target.closest(
    "button,input,textarea,select,a,video,canvas,[contenteditable=true],[role=slider],.carousel,.emoji-overlay,.creative-editor,.storyview,.sheet,.nav,.gob,.ch-back,.pp-back,details"
  )) return true;
  for (let node = target; node && node !== root; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 4 && /auto|scroll/.test(style(node).overflowX)) return true;
  }
  return false;
}

// Native horizontal scrollers and controls retain their own gestures.
// Passive touch listeners leave normal vertical scrolling unchanged.
export function bindSectionSwipes({ root, current, enabled, navigate, style, sections = () => MAIN_SECTIONS }) {
  let start = null;
  root.addEventListener("touchstart", event => {
    start = null;
    if (!enabled() || event.touches.length !== 1 || ownsHorizontalGesture(event.target, root, style)) return;
    const touch = event.touches[0];
    start = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, section: current() };
  }, { passive: true });
  root.addEventListener("touchmove", event => {
    if (!start) return;
    if (event.touches.length !== 1) { start = null; return; }
    const touch = event.touches[0];
    // Once the gesture is vertical, it belongs to feed/page scrolling.
    if (Math.abs(touch.clientY - start.y) > 20 && Math.abs(touch.clientY - start.y) > Math.abs(touch.clientX - start.x)) start = null;
  }, { passive: true });
  root.addEventListener("touchcancel", () => { start = null; }, { passive: true });
  root.addEventListener("touchend", event => {
    const gesture = start; start = null;
    if (!gesture || !enabled() || current() !== gesture.section || !event.changedTouches.length) return;
    const touch = event.changedTouches[0];
    const section = nextSection(gesture.section, touch.clientX - gesture.x, touch.clientY - gesture.y, event.timeStamp - gesture.time, sections());
    if (section) navigate(section);
  }, { passive: true });
}
