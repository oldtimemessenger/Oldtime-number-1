// Pure helpers for Get On Board. No DOM or network access, so they are cheap to test.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = v => UUID.test(String(v || ""));
export const CATEGORIES = ["creative", "sports", "music", "places", "friends", "funny"];
export const FORMATS = ["photo", "video", "text", "mixed"];
export const VISIBILITY = {
  public: "Anyone signed in can see this board and its entries. Entries stay in the board unless their author shares them.",
  invite_only: "Only people you invite can see it. Sharing a link never gives anyone access.",
  private: "Only you can see it. Sharing a link never gives anyone access."
};
// Maps opted-in local interests to a real board category. Returns null when no consent or no match.
const INTEREST_CATEGORY = { Sports: "sports", Fitness: "sports", Music: "music", Comedy: "funny", Travel: "places", Food: "places", Photography: "creative", Art: "creative", Fashion: "creative", Gaming: "funny" };
export function forYouPlan(prefs) {
  if (!prefs || prefs.enabled !== true) return { sort: "newest", category: "", rank: [] };
  const rank = [...new Set((prefs.selected || []).map(i => INTEREST_CATEGORY[i]).filter(Boolean))];
  return rank.length ? { sort: "newest", category: rank[0], rank } : { sort: "newest", category: "", rank: [] };
}
export function rankBoards(boards, rank) {
  if (!rank?.length) return boards;
  const score = b => { const i = rank.indexOf(b.category); return i < 0 ? rank.length : i; };
  return boards.map((b, i) => [b, i]).sort((a, b) => score(a[0]) - score(b[0]) || a[1] - b[1]).map(x => x[0]);
}
export function parseBoardLink(input) {
  try {
    const s = String(input ?? "");
    const q = s.includes("?") ? s.slice(s.indexOf("?")) : s.startsWith("?") ? s : "";
    const p = new URLSearchParams(q.split("#")[0]);
    const boardId = p.get("board"), entryId = p.get("entry");
    if (!isUuid(boardId)) return null;
    return { boardId: boardId.toLowerCase(), entryId: isUuid(entryId) ? entryId.toLowerCase() : undefined };
  } catch { return null; }
}
export function boardLink(boardId, entryId, origin = globalThis.location?.origin || "") {
  const p = new URLSearchParams({ board: boardId }); if (entryId) p.set("entry", entryId);
  return `${origin}/?${p}`;
}
export const uuid = () => globalThis.crypto?.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
export const acceptFor = f => f === "photo" ? "image/*" : f === "video" ? "video/mp4,video/webm" : "image/*,video/mp4,video/webm";
export const canText = f => f === "text" || f === "mixed";
export function checkFile(file, format) {
  if (!file) return "Choose a file.";
  const img = /^image\//.test(file.type), vid = /^video\/(mp4|webm)$/.test(file.type);
  if (!img && !vid) return "Use a photo, MP4 or WebM video.";
  if (format === "photo" && !img) return "This board takes photos only.";
  if (format === "video" && !vid) return "This board takes videos only.";
  if (format === "text") return "This board takes text only.";
  return "";
}
export async function toJpeg(file) {
  const bmp = await createImageBitmap(file), max = 2400, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .88));
  if (!blob) throw new Error("This photo could not be converted. Try another one.");
  return blob;
}
export function clearEntryDraft(state) {
  if (state.pv) URL.revokeObjectURL(state.pv);
  Object.assign(state, { pv: null, pvType: "", file: null, entryId: null, cmp: null });
}
// Board id for the current frame: the nearest stack frame carrying a canonical UUID, else the loaded board.
export function boardIdFrom(stack, board) {
  for (let i = (stack?.length || 0) - 1; i >= 0; i--) if (isUuid(stack[i]?.id)) return stack[i].id;
  return isUuid(board?.id) ? board.id : "";
}
export const entriesUrl = (boardId, id, caption) => {
  if (!isUuid(boardId)) throw new Error("This board is not ready. Go back and open it again.");
  return `/api/boards/${boardId}/entries` + (id ? `?id=${id}&caption=${encodeURIComponent(caption || "")}` : "");
};
