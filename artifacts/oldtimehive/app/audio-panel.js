import "./audio-remix.css";
import { api } from "./store.js";
import { audioSource, audioTitle, audioSaved, audioUses, savedAudio, saveAudio, removeSavedAudio } from "./audio-library.js";
import { mediaUrl } from "./local-media.js";
import { renderAudioPanel } from "./audio-remix-view.js";
import { openRemixStudio } from "./remix-studio.js";

export function openAudioPanel({ postId, sheet, esc, icons, toast, onPosted, onClose }) {
  const owner = api.me()?.id;
  let id = postId;
  const originalFocus = document.activeElement;
  const close = (refresh = true) => {
    sheet.querySelector("audio")?.pause();
    sheet.classList.remove("on"); sheet.innerHTML = ""; sheet.onclick = null;
    document.removeEventListener("keydown", keyboard);
    if (refresh) onClose?.();
    if (originalFocus?.isConnected) originalFocus.focus();
  };
  const keyboard = event => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const controls = [...sheet.querySelectorAll("button:not(:disabled), audio, [tabindex='0']")];
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    }
  };
  const error = failure => { const target = sheet.querySelector("[data-audio-error]"); if (target) target.textContent = failure.message; };
  const current = () => {
    const post = api.post(id);
    if (api.me()?.id !== owner || !post || !api.canSeePost(post)) throw new Error("This post is unavailable.");
    return post;
  };
  const launch = mode => {
    try {
      const post = current();
      if (!audioSource(post)) throw new Error("This post doesn’t have reusable audio.");
      close(false);
      void openRemixStudio({ postId: post.id, mode, esc, icons, toast, onPosted });
    } catch (failure) { error(failure); }
  };
  const draw = async () => {
    try {
      const post = current(), source = audioSource(post);
      sheet.querySelector("audio")?.pause();
      sheet.innerHTML = renderAudioPanel({
        post: { ...post, soundTitle: source ? audioTitle(post) : post.sound || "Original audio" },
        author: api.user(source?.author || post.author), saved: audioSaved(post), library: savedAudio(), uses: audioUses(post), esc, icons
      });
      sheet.classList.add("on");
      sheet.querySelector("[data-audio-close]").onclick = () => close();
      sheet.querySelector("[data-audio-reuse]").disabled = !source;
      sheet.querySelector("[data-audio-remix]").disabled = !source || post.kind !== "video";
      sheet.querySelector("[data-audio-save]").disabled = !source;
      sheet.querySelector("[data-audio-reuse]").onclick = () => launch("reuse");
      sheet.querySelector("[data-audio-remix]").onclick = () => launch("remix");
      sheet.querySelector("[data-audio-save]").onclick = () => {
        try { saveAudio(current(), !audioSaved(current())); void draw(); }
        catch (failure) { error(failure); }
      };
      sheet.querySelectorAll("[data-audio-library]").forEach(row => {
        const open = () => { id = row.dataset.audioLibrary; void draw(); };
        row.onclick = open;
        row.onkeydown = event => { if (event.target === row && ["Enter", " "].includes(event.key)) { event.preventDefault(); open(); } };
      });
      sheet.querySelectorAll("[data-audio-remove]").forEach(button => {
        button.onclick = event => {
          event.stopPropagation();
          try { current(); removeSavedAudio(button.dataset.audioRemove); void draw(); }
          catch (failure) { error(failure); }
        };
      });
      sheet.querySelector("[data-audio-close]").focus();
      if (source) {
        const audio = sheet.querySelector("#ap-preview"), sourceId = id;
        try { const url = await mediaUrl(source.media[0]); if (audio.isConnected && sourceId === id && audioSource(current())) audio.src = url; }
        catch (failure) { if (audio.isConnected) error(failure); }
      } else error(new Error("This post doesn’t have reusable audio. Saved sounds are available in your library."));
    } catch (failure) { close(false); toast(failure.message); }
  };
  document.querySelectorAll(".clip video").forEach(video => video.pause());
  sheet.onclick = event => { if (event.target === sheet) close(); };
  document.addEventListener("keydown", keyboard);
  void draw();
}
