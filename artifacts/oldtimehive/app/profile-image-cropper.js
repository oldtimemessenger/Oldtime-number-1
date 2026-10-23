const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_SOURCE_PIXELS = 60_000_000;
const MAX_OUTPUT_BYTES = 1_900_000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export async function openProfileImageCropper(file, kind) {
  if (!file?.type?.startsWith("image/")) throw new Error("Choose an image.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("Choose an image smaller than 20 MB.");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = sourceUrl;
    try {
      await image.decode();
    } catch {
      throw new Error("This image format can’t be cropped here. Choose a JPG or PNG.");
    }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
      throw new Error("This image is too large to crop. Choose a smaller image.");
    }
    return await mountCropper(image, kind);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function mountCropper(image, kind) {
  const isAvatar = kind === "avatar";
  const title = isAvatar ? "Profile photo" : "Profile cover";
  const outputWidth = isAvatar ? 512 : 1440;
  const outputHeight = isAvatar ? 512 : 900;
  const root = document.createElement("div");
  root.className = "profile-image-cropper";
  root.innerHTML = `
    <section class="profile-image-cropper__panel" role="dialog" aria-modal="true" aria-labelledby="profile-image-cropper-title">
      <header class="profile-image-cropper__header">
        <button type="button" class="profile-image-cropper__cancel">Cancel</button>
        <h2 id="profile-image-cropper-title">Adjust ${title.toLowerCase()}</h2>
        <button type="button" class="profile-image-cropper__confirm">Use photo</button>
      </header>
      <div class="profile-image-cropper__content">
        <canvas class="profile-image-cropper__canvas ${isAvatar ? "is-avatar" : "is-cover"}" aria-label="Drag or pinch to position and size your image"></canvas>
        <p class="profile-image-cropper__hint">Drag or pinch to position and size</p>
        <div class="profile-image-cropper__zoom">
          <button type="button" class="profile-image-cropper__zoom-step" data-zoom-step="-0.15" aria-label="Zoom out">−</button>
          <input type="range" class="profile-image-cropper__slider" min="1" max="3" step="0.01" value="1" aria-label="Photo size" />
          <button type="button" class="profile-image-cropper__zoom-step" data-zoom-step="0.15" aria-label="Zoom in">+</button>
          <button type="button" class="profile-image-cropper__reset">Reset</button>
        </div>
      </div>
    </section>`;
  const canvas = root.querySelector("canvas");
  const slider = root.querySelector(".profile-image-cropper__slider");
  const confirm = root.querySelector(".profile-image-cropper__confirm");
  const hint = root.querySelector(".profile-image-cropper__hint");
  document.body.append(root);

  let viewWidth = 0;
  let viewHeight = 0;
  let baseScale = 1;
  let zoom = 1;
  let x = 0;
  let y = 0;
  let drag = null;
  let pinch = null;
  let finished = false;
  const activePointers = new Map();

  const clampPosition = () => {
    const drawnWidth = image.naturalWidth * baseScale * zoom;
    const drawnHeight = image.naturalHeight * baseScale * zoom;
    x = clamp(x, viewWidth - drawnWidth, 0);
    y = clamp(y, viewHeight - drawnHeight, 0);
  };
  const draw = (preservePosition = true) => {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = rect.width;
    const nextHeight = rect.height;
    if (!nextWidth || !nextHeight) return;
    if (viewWidth && viewHeight && preservePosition) {
      x *= nextWidth / viewWidth;
      y *= nextHeight / viewHeight;
    } else {
      x = 0;
      y = 0;
    }
    viewWidth = nextWidth;
    viewHeight = nextHeight;
    baseScale = Math.max(viewWidth / image.naturalWidth, viewHeight / image.naturalHeight);
    if (!preservePosition || zoom === 1 && x === 0 && y === 0) {
      x = (viewWidth - image.naturalWidth * baseScale) / 2;
      y = (viewHeight - image.naturalHeight * baseScale) / 2;
    }
    clampPosition();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(viewWidth * ratio);
    canvas.height = Math.round(viewHeight * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, viewWidth, viewHeight);
    context.drawImage(image, x, y, image.naturalWidth * baseScale * zoom, image.naturalHeight * baseScale * zoom);
  };
  const setZoomAt = (nextZoom, centerX = viewWidth / 2, centerY = viewHeight / 2) => {
    const next = clamp(nextZoom, 1, 3);
    const sourceX = (centerX - x) / (baseScale * zoom);
    const sourceY = (centerY - y) / (baseScale * zoom);
    zoom = next;
    x = centerX - sourceX * baseScale * zoom;
    y = centerY - sourceY * baseScale * zoom;
    clampPosition();
    slider.value = String(zoom);
    draw();
  };
  const pointerPosition = event => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const pointerPair = () => [...activePointers.entries()].slice(0, 2);
  const startPinch = () => {
    const pair = pointerPair();
    if (pair.length < 2) return;
    const [a, b] = pair.map(([, point]) => point);
    const centerX = (a.x + b.x) / 2;
    const centerY = (a.y + b.y) / 2;
    pinch = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      centerX, centerY, zoom, x, y,
      sourceX: (centerX - x) / (baseScale * zoom),
      sourceY: (centerY - y) / (baseScale * zoom),
    };
    drag = null;
  };
  const onPointerDown = event => {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    activePointers.set(event.pointerId, pointerPosition(event));
    if (activePointers.size === 1) {
      const point = activePointers.get(event.pointerId);
      drag = { id: event.pointerId, startX: point.x, startY: point.y, x, y };
    } else {
      startPinch();
    }
  };
  const onPointerMove = event => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    activePointers.set(event.pointerId, pointerPosition(event));
    if (activePointers.size >= 2) {
      const pair = pointerPair().map(([, point]) => point);
      const [a, b] = pair;
      const centerX = (a.x + b.x) / 2;
      const centerY = (a.y + b.y) / 2;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const nextZoom = clamp(pinch.zoom * distance / pinch.distance, 1, 3);
      zoom = nextZoom;
      x = centerX - pinch.sourceX * baseScale * zoom;
      y = centerY - pinch.sourceY * baseScale * zoom;
      clampPosition();
      slider.value = String(zoom);
      draw();
      return;
    }
    if (drag?.id === event.pointerId) {
      const point = activePointers.get(event.pointerId);
      x = drag.x + point.x - drag.startX;
      y = drag.y + point.y - drag.startY;
      clampPosition();
      draw();
    }
  };
  const onPointerUp = event => {
    activePointers.delete(event.pointerId);
    if (activePointers.size >= 2) {
      startPinch();
      return;
    }
    pinch = null;
    if (activePointers.size === 1) {
      const [[id, point]] = activePointers;
      drag = { id, startX: point.x, startY: point.y, x, y };
    } else {
      drag = null;
    }
  };
  const onWheel = event => {
    event.preventDefault();
    const point = pointerPosition(event);
    setZoomAt(zoom + (event.deltaY < 0 ? 0.08 : -0.08), point.x, point.y);
  };
  const finish = (result, error) => {
    if (finished) return;
    finished = true;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    root.remove();
    if (error) rejectPromise(error);
    else resolvePromise(result);
  };
  const onResize = () => draw();
  const onKeyDown = event => {
    if (event.key === "Escape") finish(null);
  };

  let resolvePromise;
  let rejectPromise;
  const resultPromise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  root.querySelector(".profile-image-cropper__cancel").onclick = () => finish(null);
  root.querySelector(".profile-image-cropper__reset").onclick = () => {
    zoom = 1;
    x = (viewWidth - image.naturalWidth * baseScale) / 2;
    y = (viewHeight - image.naturalHeight * baseScale) / 2;
    slider.value = "1";
    draw();
  };
  root.querySelectorAll("[data-zoom-step]").forEach(button => {
    button.onclick = () => setZoomAt(zoom + Number(button.dataset.zoomStep));
  });
  slider.oninput = () => setZoomAt(Number(slider.value));
  confirm.onclick = () => {
    confirm.disabled = true;
    const output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = outputHeight;
    const context = output.getContext("2d");
    if (!context) {
      confirm.disabled = false;
      return;
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    const ratio = outputWidth / viewWidth;
    context.drawImage(image, x * ratio, y * ratio, image.naturalWidth * baseScale * zoom * ratio, image.naturalHeight * baseScale * zoom * ratio);
    const makeFile = quality => output.toBlob(blob => {
      if (!blob) {
        hint.textContent = "Couldn’t prepare this photo. Try another image.";
        hint.classList.add("is-error");
        confirm.disabled = false;
        return;
      }
      if (blob.size > MAX_OUTPUT_BYTES && quality > 0.72) {
        makeFile(0.72);
        return;
      }
      if (blob.size > 2 * 1024 * 1024) {
        hint.textContent = "This photo is too detailed to save. Try another image.";
        hint.classList.add("is-error");
        confirm.disabled = false;
        return;
      }
      finish(new File([blob], `profile-${kind}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", quality);
    makeFile(0.86);
  };
  root.addEventListener("click", event => {
    if (event.target === root) finish(null);
  });
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKeyDown);
  requestAnimationFrame(() => {
    draw(false);
    root.querySelector(".profile-image-cropper__cancel").focus();
  });
  return resultPromise;
}
