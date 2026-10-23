export async function finishStartup() {
  const opening = document.getElementById("oldtime-startup");
  if (!opening || opening.dataset.ready === "true") return;
  opening.dataset.ready = "true";
  const app = document.getElementById("app");
  app?.removeAttribute("inert");
  app?.removeAttribute("aria-hidden");
  opening.classList.add("is-complete");
  opening.querySelector('[role="progressbar"]')?.setAttribute("aria-valuenow", "100");
  opening.querySelector('[role="progressbar"]')?.setAttribute("aria-valuemin", "0");
  opening.querySelector('[role="progressbar"]')?.setAttribute("aria-valuemax", "100");
  opening.querySelector("#oldtime-startup-label").textContent = "Ready";
  requestAnimationFrame(() => {
    opening.classList.add("is-dismissed");
    setTimeout(() => opening.remove(), 240);
  });
}
