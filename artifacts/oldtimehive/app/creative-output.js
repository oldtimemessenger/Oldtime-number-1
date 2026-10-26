// Output is a project decision, never a side effect of a text style or GIF.
export function projectOutputKind(project, assets) {
  if (project?.outputKind === "photo" || project?.outputKind === "video") return project.outputKind;
  // Backward compatibility: only actual video media implies a legacy video project.
  const scenes = [project, ...(project?.pages || [])];
  return scenes.some(scene => scene?.background?.kind === "video" ||
    scene?.audioTracks?.some(track => track?.media) ||
    scene?.layers?.some(layer => layer.kind === "video" || assets?.get?.(layer.media)?.tagName === "VIDEO"))
    ? "video" : "photo";
}

export function matchingOriginal(blob, outputKind) {
  return blob?.type?.startsWith(outputKind === "video" ? "video/" : "image/") ? blob : null;
}
