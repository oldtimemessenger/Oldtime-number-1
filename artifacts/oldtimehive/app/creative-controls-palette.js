// Tools theme for the creative editor only. Never touches the project canvas, photos or the rest of the app.
import { api } from "./store.js";
export const TOOLS_THEMES = ["dark", "light"];
export const TOOLS_THEME_KEY = "oldtime.creative.toolsTheme";
export const normalizeToolsTheme = (value) => (TOOLS_THEMES.includes(value) ? value : "dark");
export function loadToolsTheme() {
  return normalizeToolsTheme(api.cloudAccountState()?.creativeToolsTheme);
}
export async function saveToolsTheme(theme) {
  await api.updateCloudAccountState({ creativeToolsTheme: normalizeToolsTheme(theme) });
  return true;
}
function reportSaveError(error) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("oldtime-account-state-error", {
    detail: { message: error?.message || "Editor settings could not be saved online." },
  }));
}
export function bindToolsTheme(editor) {
  let theme = loadToolsTheme();
  let revision = 0;
  const owner = api.cloudAccountId();
  applyToolsTheme(editor, theme);
  if (owner) {
    void api.loadCloudAccountState().then(state => {
      if (api.cloudAccountId() !== owner || revision) return;
      theme = normalizeToolsTheme(state?.creativeToolsTheme);
      applyToolsTheme(editor, theme);
    }).catch(reportSaveError);
  }
  const onClick = async (event) => {
    const button = event.target.closest?.("[data-ce-tools-theme]");
    if (!button || !editor.contains(button)) return;
    const previous = theme;
    theme = applyToolsTheme(editor, button.dataset.ceToolsTheme);
    const savedRevision = ++revision;
    try {
      await saveToolsTheme(theme);
    } catch (error) {
      if (revision === savedRevision && api.cloudAccountId() === owner) {
        theme = previous;
        applyToolsTheme(editor, theme);
      }
      reportSaveError(error);
    }
  };
  editor.addEventListener("click", onClick);
  return () => editor.removeEventListener("click", onClick);
}
export function applyToolsTheme(editor, theme) {
  const value = normalizeToolsTheme(theme);
  editor.dataset.ceTools = value;
  editor.querySelectorAll("[data-ce-tools-theme]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.ceToolsTheme === value)));
  return value;
}
