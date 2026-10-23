import "./place-picker.css";
import { requestCloudApi } from "./store.js";
let cache = [];
const mk = (label, extra = {}) => ({ id: extra.id || `custom:${crypto.randomUUID()}`, label, source: "custom", ...extra });
export function closePlacePicker() { document.querySelector(".pp-back")?.remove(); }
export function openPlacePicker({ value = null, onSelect, onRemove, toast = () => {} } = {}) {
  closePlacePicker();
  const back = document.createElement("div"); back.className = "pp-back";
  back.innerHTML = `<div class="pp-sheet" role="dialog" aria-modal="true" aria-label="Choose a place"><h2>Add place</h2>
    <small>Optional. Nothing is shared unless you choose a place.</small>
    <div class="pp-cur" hidden><span></span><span><button data-edit type="button">Edit</button> <button data-rm type="button">Remove</button></span></div>
    <div class="pp-row"><input maxlength="80" placeholder="Type a place name" aria-label="Place name"><button class="pp-main" data-use type="button">Use</button></div>
    <div class="pp-row"><button data-search type="button">Find places</button><button data-near type="button">Nearby</button><button data-close type="button">Close</button></div>
    <small class="pp-note"></small><div class="pp-list"></div></div>`;
  document.body.appendChild(back);
  const $ = s => back.querySelector(s), input = $("input"), list = $(".pp-list"), cur = $(".pp-cur"), note = $(".pp-note");
  let place = value;
  const choose = p => { place = p; onSelect?.(p); closePlacePicker(); };
  const showCur = () => { cur.hidden = !place; if (place) cur.firstElementChild.textContent = place.label; };
  const renderList = () => {
    const q = input.value.trim().toLowerCase();
    list.replaceChildren(...cache.filter(p => !q || p.label.toLowerCase().includes(q)).map(p => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = p.label; b.onclick = () => choose(p); return b;
    }));
  };
  showCur(); renderList(); if (place) input.value = place.label;
  input.oninput = renderList;
  input.onkeydown = e => { if (e.key === "Enter") $("[data-use]").click(); };
  back.onclick = e => { if (e.target === back) closePlacePicker(); };
  $("[data-close]").onclick = closePlacePicker;
  $("[data-edit]").onclick = () => { input.value = place.label; input.focus(); };
  $("[data-rm]").onclick = () => { place = null; onRemove?.(); closePlacePicker(); };
  $("[data-use]").onclick = () => {
    const label = input.value.trim().replace(/\s+/g, " ");
    if (!label) return toast("Type a place name or search nearby.");
    choose(place && place.label === label ? place : mk(label));
  };
  const search = async (coords = null) => {
    const query = input.value.trim();
    if (query.length < 2) { note.textContent = "Type a place name to search."; return; }
    note.textContent = "Finding places…";
    try {
      const position = coords ? `&lat=${Number(coords.latitude.toFixed(3))}&lon=${Number(coords.longitude.toFixed(3))}` : "";
      const d = await requestCloudApi(`/api/places/search?q=${encodeURIComponent(query)}${position}`);
      if (!back.isConnected) return;
      cache = (d.places || []).filter(p => p?.label).map(p => ({ id: String(p.id), label: p.label, lat: p.lat, lon: p.lon, source: "osm" }));
      note.textContent = cache.length ? "" : "No places found. You can use this name.";
      if (cache.length) {
        const a = document.createElement("a"); a.href = "https://www.openstreetmap.org/copyright"; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = d.attribution?.text || "© OpenStreetMap contributors"; note.appendChild(a);
      }
      renderList();
    } catch { if (back.isConnected) note.textContent = "Search unavailable. You can use this name."; }
  };
  $("[data-search]").onclick = () => search();
  $("[data-near]").onclick = () => {
    if (input.value.trim().length < 2) { note.textContent = "Type a place name to search nearby."; return; }
    if (!navigator.geolocation) return toast("Location isn't available. Type a place instead.");
    note.textContent = "Looking nearby…";
    navigator.geolocation.getCurrentPosition(({ coords }) => { if (back.isConnected) search(coords); },
      () => { if (back.isConnected) note.textContent = "Location off. You can search by name."; }, { timeout: 10000, maximumAge: 300000 });
  };
  input.focus();
}
