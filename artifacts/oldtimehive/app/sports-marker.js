export const POSITION_RED = "#ed2339";
export const JET_FLAME_ORANGE = "#ff351e";
export const JET_ENGINE_GLOW = "#fff0e8";
export function markerPulse(time, still = false) {
  const phase = still ? 0 : ((Math.max(0, time) % 1500) / 1500);
  const shimmer = still ? .5 : .5 + .5 * Math.cos(phase * Math.PI * 2);
  return {
    radius: 30 + 22 * phase,
    opacity: still ? .3 : .58 * (1 - phase),
    engineRadius: 13 + shimmer * 5,
    engineOpacity: .6 + shimmer * .35,
  };
}
