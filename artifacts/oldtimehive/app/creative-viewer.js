import "./creative-editor.css";
import { api } from "./store.js";
import { projectSources, hitLayer, projectScenes } from "./creative-project.js";
import { CreativeAssets, drawProject } from "./creative-renderer.js";
import { resolveCommentSource } from "./creative-content.js";
import { openCreativeResponse } from "./creative-responses.js";
import {syncVideoEdit,videoPoint} from "./creative-video-edit.js";
import { invalidateMediaUrl } from "./local-media.js";

const viewers = new Map();
export function creativeMediaMarkup(item, esc, story = false, thumbnail = false, initialSlide = 0) {
  const scenes = projectScenes(item.creativeProject);
  const carousel = !story && !thumbnail && item.kind === "carousel" && scenes.length > 1;
  const selected = carousel ? Math.max(0, Math.min(scenes.length - 1, Number(initialSlide) || 0)) : 0;
  const canvas = `<canvas class="${thumbnail ? "creative-thumbnail-media" : story ? "creative-story-media" : "creative-post-media"}" width="1080" height="1920"
    data-creative-id="${esc(item.id)}" ${story ? 'data-creative-story="true"' : ""}
    ${carousel ? `data-creative-carousel="true" data-creative-initial-slide="${selected}" role="img" aria-label="Photo ${selected + 1} of ${scenes.length}"` : thumbnail ? 'data-creative-thumbnail="true" role="img" aria-label="Remix preview"' : 'role="button" tabindex="0" aria-label="Comment remix. Tap the original comment to open its context."' }></canvas>`;
  return carousel ? `<div class="creative-post-carousel" data-carousel-count="${scenes.length}">${canvas}<span class="creative-carousel-count" data-creative-carousel-count>${selected + 1}/${scenes.length}</span></div>` : canvas;
}
export function creativeAttribution(item, esc) {
  const source = projectSources(item.creativeProject)[0];
  if (!source) return "";
  return `<button type="button" class="creative-attribution" data-creative-source-post="${esc(source.postId)}"
    data-creative-source-comment="${esc(source.commentId)}">Remixed from @${esc(api.user(source.commentAuthorId)?.username || "member")}</button>`;
}
export function creativeAspect(project) {
  const scene=projectScenes(project)[0];
  const ratio=Number(scene?.width)/Number(scene?.height);
  return Number.isFinite(ratio)?Math.max(.3,Math.min(3,ratio)):9/16;
}
export function setCreativeMuted(root, value) {
  for (const [canvas, instance] of viewers) if (root.contains(canvas)) instance.mute(value);
}
export function mountCreativeViewers(root, { onSource, muted = true, resolveItem, canViewItem, onSticker } = {}) {
  root.querySelectorAll("[data-creative-source-post]").forEach(button => button.onclick = event => {
    event.stopPropagation(); onSource?.(button.dataset.creativeSourcePost, button.dataset.creativeSourceComment);
  });
  root.querySelectorAll("canvas[data-creative-id]").forEach(canvas => {
    if (viewers.has(canvas)) return;
    const lookup=()=>resolveItem?resolveItem(canvas.dataset.creativeId):canvas.dataset.creativeStory?api.db().stories.find(story=>story.id===canvas.dataset.creativeId):api.post(canvas.dataset.creativeId);
    const item = lookup();
    if (!item?.creativeProject) return;
    const recordProject=item.creativeProject, scenes=projectScenes(recordProject), assets = new CreativeAssets();
    let project=scenes[0], sceneIndex=0;
    canvas.width=project.width;canvas.height=project.height;
    const thumbnail = !!canvas.dataset.creativeThumbnail;
    const carousel = canvas.dataset.creativeCarousel === "true" && scenes.length > 1;
    let closed = false, frame, thumbnailTimer, start = performance.now(), measurements = new Map(), time = 0, visible = false, video;
    let started = false, ready = false;
    if (carousel) sceneIndex = Math.max(0, Math.min(scenes.length - 1, Number(canvas.dataset.creativeInitialSlide) || 0));
    project = scenes[sceneIndex] || project;
    if (carousel) canvas.setAttribute("aria-label", `Photo ${sceneIndex + 1} of ${scenes.length}`);
    const setCarouselSlide = value => {
      if (!carousel) return;
      sceneIndex = Math.max(0, Math.min(scenes.length - 1, Number(value) || 0));
      project = scenes[sceneIndex];
      time = 0; start = performance.now();
      canvas.width = project.width; canvas.height = project.height;
      canvas.setAttribute("aria-label", `Photo ${sceneIndex + 1} of ${scenes.length}`);
      const count = canvas.closest(".creative-post-carousel")?.querySelector("[data-creative-carousel-count]");
      if (count) count.textContent = `${sceneIndex + 1}/${scenes.length}`;
      const clip = canvas.closest(".clip");
      clip?.querySelectorAll("[data-dot]").forEach(button => {
        const [, slide] = button.dataset.dot.split(":");
        const selected = Number(slide) === sceneIndex;
        button.classList.toggle("on", selected); button.setAttribute("aria-pressed", String(selected));
      });
      canvas.dispatchEvent(new CustomEvent("creative-carousel-change", { bubbles: true, detail: { id: item.id, index: sceneIndex } }));
    };
    let pointerStart = null, suppressOpen = false;
    if (carousel) {
      canvas.addEventListener("creative-carousel-index", event => setCarouselSlide(event.detail));
      canvas.onpointerdown = event => { pointerStart = { x: event.clientX, y: event.clientY }; };
      canvas.onpointerup = event => {
        if (!pointerStart) return;
        const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y;
        pointerStart = null;
        if (Math.abs(dx) < 40 || Math.abs(dx) <= Math.abs(dy)) return;
        suppressOpen = true;
        setCarouselSlide(sceneIndex + (dx < 0 ? 1 : -1));
        event.preventDefault(); event.stopPropagation();
      };
    }
    const valid = () => {
      const current = lookup();
      return current && (canViewItem?canViewItem(current):canvas.dataset.creativeStory ? Date.now() - current.created < 24 * 60 * 60 * 1000 && api.canSeeStory(current) : api.canSeePost(current));
    };
    const dispose = () => { closed = true; cancelAnimationFrame(frame); clearTimeout(thumbnailTimer); observer?.disconnect(); assets.dispose(); viewers.delete(canvas); };
    const observer = new IntersectionObserver(entries => {
      if (!canvas.isConnected) { dispose(); return; }
      visible = entries[0].isIntersecting;
      if (visible && !started) { started = true; void loadAssets(); }
      else if (visible && ready && !frame) schedule();
      if (!visible) { cancelAnimationFrame(frame); frame = 0; clearTimeout(thumbnailTimer); }
      if (video) { if (visible && !thumbnail) void video.play().catch(() => {}); else video.pause(); }
    }, { rootMargin: "250px 0px" });
    observer.observe(canvas);
    const unavailable = (message = "Original comment unavailable") => {
      const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#17191d"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff"; ctx.font = "500 44px Manrope, sans-serif"; ctx.textAlign = "center";
      ctx.fillText(message, canvas.width / 2, canvas.height / 2);
      canvas.setAttribute("aria-label", message);
    };
    const render = () => {
      frame = 0;
      if (closed) return;
      if (!canvas.isConnected) { dispose(); return; }
      if (!visible) return;
      const attribution = canvas.closest(".clip, #storyview")?.querySelector(".creative-attribution");
      if (!valid()) { unavailable(); if (attribution) attribution.hidden = true; video?.pause(); schedule(); return; }
      if (attribution) attribution.hidden = false;
      if (visible) {
        if(resolveItem&&!carousel)project=projectScenes(lookup().creativeProject)[sceneIndex]||project;
        if (carousel) {
          project = scenes[sceneIndex];
          time = 0;
        } else if(!thumbnail&&scenes.length>1){
          const total=scenes.reduce((sum,scene)=>sum+scene.duration,0),at=(performance.now()-start)/1000%total;
          let offset=0,index=0;
          for(let i=0;i<scenes.length;i++){if(at<offset+scenes[i].duration){index=i;break;}offset+=scenes[i].duration;}
          if(index!==sceneIndex){
            video?.pause();sceneIndex=index;project=scenes[index];canvas.width=project.width;canvas.height=project.height;
            const asset=assets.get(project.background.media);video=asset?.tagName==="VIDEO"?asset:null;
            if(video){video.loop=false;video.muted=muted;video.currentTime=0;void video.play().catch(()=>{});}
          }
          time=at-offset;
        } else {
        time = thumbnail ? Math.min(project.duration, (project.layers.find(layer => layer.kind === "comment")?.startTime || 0) + .05)
          : video&&!project.background.videoEdit ? Math.min(video.currentTime, project.duration) : (performance.now() - start) / 1000 % project.duration;
        }
        if(video&&project.background.videoEdit)syncVideoEdit(video,project.background,time,!thumbnail);
        else if (video && video.currentTime >= project.duration) video.currentTime = 0;
        measurements = drawProject(canvas, project, assets, resolveCommentSource, time);
      }
      schedule();
    };
    const schedule = () => { if (!closed && visible) { if (thumbnail) thumbnailTimer = setTimeout(render, 400); else frame = requestAnimationFrame(render); } };
    const open = event => {
      if (!valid()) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(rect.width / project.width, rect.height / project.height);
      const left = rect.left + (rect.width - project.width * ratio) / 2, top = rect.top + (rect.height - project.height * ratio) / 2;
      const hit = hitLayer(project, { x: (event.clientX - left) / ratio, y: (event.clientY - top) / ratio }, measurements, time, true);
      if (hit?.kind === "comment" && resolveCommentSource(hit.source)) {event.stopPropagation();onSource?.(hit.source.postId, hit.source.commentId);}
      if (hit?.kind === "sticker" && ["poll","question"].includes(hit.sticker)) {
        event.stopPropagation();if(onSticker)onSticker(item.id,hit.id);else openCreativeResponse(item.id,!!canvas.dataset.creativeStory,hit.id);
      }
    };
    if (!thumbnail) canvas.onclick = event => {
      if (suppressOpen) { suppressOpen = false; event.preventDefault(); event.stopPropagation(); return; }
      open(event);
    };
    canvas.onkeydown = event => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault(); const source = projectSources(project)[0];
      if (source && valid()) onSource?.(source.postId, source.commentId);
    };
    viewers.set(canvas, { dispose, mute: value => { muted=value;if (video) video.muted = value; } });
    async function loadAssets() {
      try {
        if (!valid()) { unavailable(); return; }
        await document.fonts.ready;
        await Promise.all(scenes.flatMap(scene => [
          ...(scene.background.media ? [assets.load(scene.background.media, scene.background.kind === "video" ? "video" : "image")] : []),
          ...scene.layers.filter(layer => layer.kind === "image").map(layer => assets.load(layer.media)),
        ]));
        if (project.background.media) {
          const background = assets.get(project.background.media);
          if (background?.tagName === "VIDEO") {
            video = background; video.loop = !project.background.videoEdit; video.muted = thumbnail || muted;
            if (thumbnail) video.currentTime = videoPoint(project.background,Math.min(project.duration, (project.layers.find(layer => layer.kind === "comment")?.startTime || 0) + .05)).sourceTime;
            else if (visible) await video.play().catch(() => {});
          }
        }
        for (const scene of scenes) for (const layer of scene.layers) {
          if (layer.kind === "image") await assets.load(layer.media);
          if (layer.kind === "comment") {
            const source = resolveCommentSource(layer.source);
            if (source) await Promise.all([source.author.avatar, source.comment.attachment?.url].filter(Boolean).map(key => assets.load(key).catch(() => {})));
          }
        }
        ready = true;
        if (!closed) render();
      } catch {
        if (canvas.isConnected) {
          unavailable("Media could not load");
          if (!canvas.nextElementSibling?.classList.contains("creative-media-retry")) {
            const retry = document.createElement("button");
            retry.type = "button"; retry.className = "creative-media-retry";
            retry.textContent = "Retry media";
            retry.onclick = event => {
              event.preventDefault(); event.stopPropagation(); retry.remove();
              for (const scene of scenes) {
                invalidateMediaUrl(scene.background.media);
                for (const layer of scene.layers) if (layer.media) invalidateMediaUrl(layer.media);
              }
              void loadAssets();
            };
            canvas.after(retry);
          }
        }
      }
    }
  });
  for (const [canvas, instance] of viewers) if (!canvas.isConnected) instance.dispose();
}
