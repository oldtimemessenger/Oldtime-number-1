const DEFAULT_MAX_GAP_MS = 2 * 60 * 1000;

export function areConsecutiveMessages(firstMessage, nextMessage, maxGapMs = DEFAULT_MAX_GAP_MS) {
  if (
    !firstMessage ||
    !nextMessage ||
    firstMessage.kind === "system" ||
    nextMessage.kind === "system" ||
    firstMessage.author !== nextMessage.author
  ) return false;

  const firstTime = new Date(firstMessage.created).getTime();
  const nextTime = new Date(nextMessage.created).getTime();
  return Number.isFinite(firstTime) &&
    Number.isFinite(nextTime) &&
    nextTime >= firstTime &&
    new Date(firstTime).toDateString() === new Date(nextTime).toDateString() &&
    nextTime - firstTime <= maxGapMs;
}
