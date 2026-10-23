// ICE prefers direct peer-to-peer candidates. TURN is added only when a
// trusted page config explicitly allows it and its short-lived credentials
// have not expired.

export const STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302"
];

export function turnConfig() {
  try {
    const turn = window.OLD_TIME_TURN;
    const urls = Array.isArray(turn?.urls) ? turn.urls : [turn?.urls];
    if (
      !turn ||
      turn.allowAutomaticRelay !== true ||
      urls.length === 0 ||
      urls.some(url => typeof url !== "string" || (!url.startsWith("turn:") && !url.startsWith("turns:"))) ||
      typeof turn.username !== "string" ||
      !turn.username ||
      typeof turn.credential !== "string" ||
      !turn.credential ||
      !Number.isFinite(turn.expiresAt) ||
      turn.expiresAt <= Date.now()
    ) return null;
    return { ...turn, urls };
  } catch {
    return null;
  }
}

export function iceServers({ allowTurnFallback = false } = {}) {
  const servers = [{ urls: [...STUN_URLS] }];
  const turn = allowTurnFallback ? turnConfig() : null;
  if (turn) {
    servers.push({
      urls: turn.urls,
      username: turn.username,
      credential: turn.credential,
    });
  }
  return {
    iceServers: servers,
    // ICE candidate priorities prefer direct paths; TURN is the fallback
    // candidate when direct connectivity is unavailable.
    iceTransportPolicy: "all"
  };
}
// Call signaling remains server-backed; audio/video media is peer-to-peer
// unless the explicitly enabled TURN fallback is selected.
