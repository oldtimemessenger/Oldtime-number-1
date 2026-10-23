export function shouldAutoStartCamera({
  startCamera = false,
  startStudio = false,
  hasSource = false,
  hasInitialProject = false,
  hasBackground = false,
  hasSaveHandler = false
} = {}) {
  return !startStudio &&
    !hasSource &&
    !hasInitialProject &&
    !hasBackground &&
    (startCamera || !hasSaveHandler);
}
