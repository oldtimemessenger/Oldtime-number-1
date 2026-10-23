import { icon } from "./icons.js";
import { api } from "./store.js";

const groups = [
  ["Smileys", "Faces and feelings", "😀 😃 😄 😁 😆 😅 😂 🤣 🥲 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣 🤭 🫢 🫡 🤫 🫠 🤥 😶 😶‍🌫️ 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😮‍💨 😵 😵‍💫 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 👻 💀 ☠️ 👽 🤖 💩"],
  ["People", "People and gestures", "👋 🤚 🖐️ ✋ 🖖 🫶 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🙏 ✍️ 💅 🤳 💪 🦵 🦶 👂 👃 👶 👧 🧒 👦 👩 🧑 👨 👵 🧓 👴 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 👷 💂 🕵️ 👩‍⚕️ 👨‍⚕️ 👩‍🎓 👨‍🎓 👩‍💻 👨‍💻 👩‍🚀 👨‍🚀 🧕 👳 🧔 👱 🤰 🤱 👼 🎅 🤶 🧑‍🎄 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🧘 🏄 🏊 🚴 🏋️ 🤸 👩‍❤️‍👨 👩‍❤️‍👩 👨‍❤️‍👨 👨‍👩‍👧‍👦 👩‍👩‍👦 👨‍👨‍👧"],
  ["Nature", "Animals and nature", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🪲 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐠 🐟 🐬 🐳 🦈 🐊 🐘 🦒 🦓 🦍 🦧 🦣 🐪 🦙 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦦 🦥 🐁 🐿️ 🦔 🌵 🎄 🌲 🌳 🌴 🪴 🌱 🌿 ☘️ 🍀 🎍 🎋 🍃 🍂 🍁 🍄 🐚 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌙 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌈 ☀️ 🌤️ ☁️ 🌧️ ⛈️ ❄️ ☃️ 💨 💧 🌊"],
  ["Food", "Food and drink", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳 🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🍾 🧊"],
  ["Activities", "Sports and celebrations", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🥍 🏏 🥅 ⛳ 🪁 🏹 🎣 🤿 🥊 🥋 🎽 🛹 🛼 🛷 ⛸️ 🥌 🎿 ⛷️ 🏂 🪂 🏆 🥇 🥈 🥉 🏅 🎖️ 🎗️ 🎫 🎟️ 🎪 🤹 🎭 🩰 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎈 🎁 🎀 🪅 🪩"],
  ["Travel", "Travel and places", "🚗 🚕 🚙 🚌 🚎 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 🚡 🚠 🚟 🚃 🚋 🚞 🚝 🚄 🚅 🚈 🚂 🚆 🚇 🚊 🚉 ✈️ 🛫 🛬 🛩️ 💺 🛰️ 🚀 🛸 🚁 🛶 ⛵ 🚤 🛥️ 🛳️ ⛴️ 🚢 ⚓ 🛟 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ ⛱️ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🗻 🏕️ 🛖 🏠 🏡 🏘️ 🏚️ 🏗️ 🏭 🏢 🏬 🏣 🏥 🏦 🏨 🏪 🏫 🏩 💒 🏛️ ⛪ 🕌 🕍 🛕 🕋 ⛩️ 🛤️ 🛣️ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉"],
  ["Objects", "Objects and tools", "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💽 💾 💿 📀 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ 🎚️ ⏱️ ⏰ ⌛ 🔋 🔌 💡 🔦 🕯️ 🧯 🛢️ 💸 💵 💴 💶 💷 🪙 💰 💳 💎 ⚖️ 🧰 🔧 🔨 ⚒️ 🛠️ ⛏️ 🪛 🔩 ⚙️ 🧱 ⛓️ 🧲 🪜 🧪 🧫 🧬 🔬 🔭 📡 💉 💊 🩹 🩺 🚪 🪞 🪟 🛏️ 🛋️ 🪑 🚽 🚿 🛁 🧴 🪥 🧹 🧺 🧻 🪣 🧼 🧽 🛍️ 🛒 🎒 👜 👛 👝 🧳 🌂 ☂️ 🧵 🪡 🧶 👓 🕶️ 🥽 🥼 🦺 👔 👕 👖 🧣 🧤 🧥 🧦 👗 👚 👙 👟 👞 👠 👡 👢 👑 💍 💄 📚 📖 📝 ✏️ 🖊️ 📌 📍 📎 ✂️ 🔒 🔓 🔑 🗝️ 📧 ✉️ 📦"],
  ["Symbols", "Hearts and symbols", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 🩷 🩵 🩶 💔 ❤️‍🔥 ❤️‍🩹 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☸️ ✡️ 🔯 🕎 ☯️ ☦️ 🛐 ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆔 ⚛️ 🈳 🈹 🈺 🈯 ✅ ☑️ ✔️ ❌ ❎ ➕ ➖ ➗ ✖️ ♾️ 💯 🔱 ⚜️ 🔔 🔕 📣 📢 💬 💭 🗯️ ♠️ ♣️ ♥️ ♦️ 🃏 🎴 🀄 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔸 🔹 🔶 🔷 🔳 🔲 ▪️ ▫️ ◼️ ◻️ ⬛ ⬜ 🟧 🟨 🟩 🟦 🟪 🟥 🟫 🆘 🆕 🆗 🆒 🆓 🔝 🔜 🔙 🔚 🔛"],
];
const codes = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW EU UN";
const names = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const entries = groups.flatMap(([category, label, list]) => list.split(" ").map(emoji => ({ emoji, category, name: `${label} ${emoji}` })));
const flagCodes = [...new Set([...codes.split(" "), "AC", "CP", "CQ", "DG", "EA", "IC", "TA"])].sort();
entries.push(...flagCodes.map(code => ({ emoji: [...code].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join(""), category: "Flags", name: `${names?.of(code) || code} flag ${code}` })));
entries.push(...["🏳️", "🏴", "🏁", "🚩", "🏳️‍🌈", "🏳️‍⚧️", "🏴‍☠️"].map(emoji => ({ emoji, category: "Flags", name: `Special flag ${emoji}` })));
entries.push(...[["England", "gbeng"], ["Scotland", "gbsct"], ["Wales", "gbwls"]].map(([name, tag]) => ({
  emoji: "🏴" + [...tag].map(char => String.fromCodePoint(0xE0000 + char.charCodeAt(0))).join("") + String.fromCodePoint(0xE007F),
  category: "Flags", name: `${name} flag`
})));
export const emojiFlags = Object.freeze(entries.filter(entry => entry.category === "Flags").map(entry => entry.emoji));
const categoryMarks = { Recent: "◷", Smileys: "☺", People: "👋", Nature: "🌿", Food: "🍎", Activities: "🎉", Travel: "🚗", Objects: "💡", Symbols: "❤️", Flags: "🏳️" };
let closePicker = null;

// Pickers offer the default yellow style, including older recents/favorites.
// Do not rewrite text already posted or sent by users.
export function defaultEmoji(emoji) { return emoji.replace(/\p{Emoji_Modifier}/gu, ""); }
export function defaultEmojiList(items, limit) {
  return [...new Set(items.filter(item => typeof item === "string").map(defaultEmoji))].slice(0, limit);
}

export function closeEmojiPicker() { closePicker?.(); }

export function openEmojiPicker(target, onChange = () => {}, options = {}) {
  closeEmojiPicker();
  const savedPreferences = api.cloudAccountState()?.emojiPreferences || {};
  let recent = defaultEmojiList(Array.isArray(savedPreferences.recent) ? savedPreferences.recent : [], 32);
  let favorites = defaultEmojiList(Array.isArray(savedPreferences.favorites) ? savedPreferences.favorites : [], 128);
  const saveEmojiPreferences = () => {
    void api.updateCloudAccountState({ emojiPreferences: { recent, favorites } }).catch(error => {
      window.dispatchEvent(new CustomEvent("oldtime-account-state-error", {
        detail: { message: error?.message || "Emoji preferences could not be saved online." },
      }));
    });
  };
  const chat = !!options.chat;
  const selectOnly = !!options.selectOnly;
  const layer = document.createElement("div");
  layer.className = `emoji-overlay${chat ? " chat-emoji-overlay" : ""}`;
  layer.innerHTML = chat
    ? `<section class="emoji-panel chat-emoji-panel" role="dialog" aria-modal="true" aria-label="Emoji and stickers">
        <div class="chat-emoji-grab"></div>
        <div class="emoji-search-row chat-emoji-search-row">
          ${icon("search")}
          <input class="emoji-search chat-emoji-search" type="search" aria-label="Search emoji" placeholder="Search Emoji" />
          <button type="button" class="emoji-close chat-emoji-close" aria-label="Close emoji picker">${icon("close")}</button>
        </div>
        <div class="emoji-grid chat-emoji-grid" aria-live="polite"></div>
        <div class="emoji-picker-footer">
          <div class="emoji-categories chat-emoji-categories" role="tablist" aria-label="Emoji categories"></div>
          <div class="chat-emoji-modebar" role="tablist" aria-label="Emoji picker sections">
            <button type="button" class="chat-emoji-mode" data-mode="favorites" aria-label="Favorites" aria-pressed="false">${icon("star")}</button>
            <button type="button" class="chat-emoji-mode on" data-mode="emoji" aria-label="Emoji" aria-pressed="true">${icon("smile")}</button>
            <button type="button" class="chat-emoji-mode" data-mode="stickers" aria-label="Stickers" aria-pressed="false">${icon("user")}</button>
          </div>
        </div>
      </section>`
    : `<section class="emoji-panel" role="dialog" aria-modal="true" aria-label="Emoji picker">
        <div class="chat-emoji-grab"></div>
        <div class="emoji-search-row">
          ${icon("search")}
          <input class="emoji-search" type="search" aria-label="Search emoji" placeholder="Search Emoji" />
          <button type="button" class="emoji-close chat-emoji-close" aria-label="Close emoji picker">${icon("close")}</button>
        </div>
        <div class="emoji-grid" aria-live="polite"></div>
        <div class="emoji-picker-footer">
          <div class="emoji-categories" role="tablist" aria-label="Emoji categories"></div>
        </div>
      </section>`;
  document.body.appendChild(layer);
  const previous = document.activeElement;
  const start = target?.selectionStart ?? target?.value?.length ?? 0;
  const end = target?.selectionEnd ?? start;
  let cursor = start;
  let replaceEnd = end;
  let favoriteHold = null;
  let suppressClickUntil = 0;
  const cancelFavoriteHold = () => { clearTimeout(favoriteHold); favoriteHold = null; };
  let category = recent.length ? "Recent" : "Smileys";
  let mode = options.mode === "stickers" ? "stickers" : "emoji";
  const search = layer.querySelector("input");
  const grid = layer.querySelector(".emoji-grid");
  const tabs = layer.querySelector(".emoji-categories");
  const remember = emoji => {
    recent = [emoji, ...recent.filter(e => e !== emoji)].slice(0, 32);
    saveEmojiPreferences();
  };
  const close = () => {
    cancelFavoriteHold();
    layer.remove();
    document.removeEventListener("keydown", keydown);
    closePicker = null;
    if (target?.isConnected) { target.focus(); target.setSelectionRange?.(cursor, cursor); }
    else if (previous?.isConnected) previous.focus();
  };
  const choose = emoji => {
    emoji = defaultEmoji(emoji);
    remember(emoji);
    if (selectOnly) { close(); onChange(emoji); return; }
    if (chat && mode === "stickers" && options.onSticker) { close(); options.onSticker(emoji); return; }
    if (target?.setRangeText) {
      target.setRangeText(emoji, cursor, replaceEnd, "end");
      cursor = target.selectionEnd;
      replaceEnd = cursor;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      onChange(target.value);
      return;
    }
    onChange(emoji);
  };
  const keydown = e => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") {
      const focusable = [...layer.querySelectorAll("button, input, select")];
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  closePicker = close;
  const draw = () => {
    if (chat) {
      layer.querySelectorAll("[data-mode]").forEach(button => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("on", active);
        button.setAttribute("aria-pressed", String(active));
      });
    }
    tabs.replaceChildren();
    const showCategories = !chat || mode === "emoji";
    tabs.hidden = !showCategories;
    if (showCategories) {
      ["Recent", ...groups.map(g => g[0]), "Flags"].forEach(label => {
        const button = document.createElement("button");
        button.textContent = chat ? (categoryMarks[label] || "•") : label;
        button.title = label;
        button.setAttribute("aria-label", label);
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(label === category));
        button.onclick = () => { category = label; search.value = ""; draw(); };
        tabs.appendChild(button);
      });
    }
    const q = search.value.trim().toLowerCase();
    const favoriteEntries = favorites.map(emoji => entries.find(e => e.emoji === emoji) || { emoji, name: emoji, category: "Favorites" });
    const source = q
      ? (chat && mode === "favorites" ? favoriteEntries : entries).filter(e => e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q))
      : chat && mode === "favorites"
        ? favoriteEntries
        : chat && mode === "stickers"
          ? entries.filter(e => ["Smileys", "People", "Activities"].includes(e.category)).slice(0, 96)
          : category === "Recent"
             ? recent.map(emoji => entries.find(e => e.emoji === emoji) || { emoji, name: emoji, category: "Recent" })
            : entries.filter(e => e.category === category);
    grid.replaceChildren();
    grid.classList.toggle("sticker-mode", chat && mode === "stickers");
    source.forEach(entry => {
      const emoji = entry.emoji;
      const button = document.createElement("button");
      button.type = "button";
      button.className = entry.category === "Flags" ? "emoji emoji-flag" : "emoji";
      button.textContent = emoji;
      button.title = entry.name;
      button.setAttribute("aria-label", entry.name);
      button.onclick = () => {
        if (Date.now() < suppressClickUntil) return;
        choose(emoji);
      };
      if (chat) {
        const tile = document.createElement("div");
        tile.className = "emoji-tile";
        tile.appendChild(button);
        if (mode !== "stickers") {
          const toggleFavorite = () => {
            cancelFavoriteHold();
            suppressClickUntil = Date.now() + 800;
            favorites = favorites.includes(emoji) ? favorites.filter(item => item !== emoji) : [emoji, ...favorites].slice(0, 128);
            saveEmojiPreferences();
            draw();
          };
          button.setAttribute("aria-description", "Touch and hold or right-click to add or remove this emoji from Favorites.");
          button.onpointerdown = event => {
            if (event.button !== 0) return;
            cancelFavoriteHold();
            const { clientX: x, clientY: y } = event;
            button.onpointermove = movement => {
              if (Math.hypot(movement.clientX - x, movement.clientY - y) > 12) cancelFavoriteHold();
            };
            favoriteHold = setTimeout(toggleFavorite, 550);
          };
          button.onpointerup = button.onpointercancel = button.onpointerleave = cancelFavoriteHold;
          button.oncontextmenu = event => {
            event.preventDefault();
            if (Date.now() >= suppressClickUntil) toggleFavorite();
          };
        }
        grid.appendChild(tile);
      } else grid.appendChild(button);
    });
    if (!source.length) {
      if (chat && mode === "favorites" && !q) grid.textContent = "Touch and hold an emoji to save it here.";
      else grid.textContent = category === "Recent" && !q ? "Your recently used emoji will appear here." : "No emoji found.";
    }
  };
  let gridTouchStart = null;
  grid.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) { gridTouchStart = null; return; }
    gridTouchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  grid.addEventListener("touchend", event => {
    if ((chat && mode !== "emoji") || search.value.trim() || !gridTouchStart) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - gridTouchStart.x;
    const dy = touch.clientY - gridTouchStart.y;
    gridTouchStart = null;
    if (Math.abs(dx) < 64 || Math.abs(dy) > 56) return;
    const categories = ["Recent", ...groups.map(group => group[0]), "Flags"];
    const index = categories.indexOf(category);
    const nextIndex = Math.max(0, Math.min(categories.length - 1, index + (dx < 0 ? 1 : -1)));
    if (nextIndex === index) return;
    category = categories[nextIndex];
    draw();
    [...tabs.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === category)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, { passive: true });
  if (chat) {
    layer.querySelectorAll("[data-mode]").forEach(button => button.onclick = () => { mode = button.dataset.mode; search.value = ""; draw(); });
  }
  search.oninput = draw;
  layer.querySelector(".emoji-close").onclick = close;
  layer.onclick = e => { if (e.target === layer) close(); };
  document.addEventListener("keydown", keydown);
  draw();
  if (!chat) search.focus();
}
