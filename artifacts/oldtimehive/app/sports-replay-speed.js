export const REPLAY_SPEEDS = Object.freeze([1, 2, 4, 8]);

export function replaySpeedFor(durationMs, preferredSpeed) {
  if (REPLAY_SPEEDS.includes(preferredSpeed)) return preferredSpeed;
  return REPLAY_SPEEDS.find(speed => durationMs / speed <= 30_000) || REPLAY_SPEEDS.at(-1);
}
