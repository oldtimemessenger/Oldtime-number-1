export const CALL_VIDEO_MAX_BITRATE = 800_000;
export const CALL_AUDIO_MAX_BITRATE = 48_000;
export const CALL_VIDEO_MAX_FRAME_RATE = 24;

export function callMediaConstraints(video) {
  return {
    audio: true,
    video: video ? {
      facingMode: { ideal: "user" },
      width: { ideal: 640, max: 640 },
      height: { ideal: 480, max: 480 },
      frameRate: { ideal: CALL_VIDEO_MAX_FRAME_RATE, max: CALL_VIDEO_MAX_FRAME_RATE },
    } : false,
  };
}

export function callVideoConstraints(facing = "user") {
  return {
    ...callMediaConstraints(true).video,
    facingMode: { ideal: facing },
  };
}

export async function capCallSender(sender, kind) {
  if (!sender?.getParameters || !sender?.setParameters || !["audio", "video"].includes(kind)) return false;
  try {
    const parameters = sender.getParameters();
    const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    for (const encoding of encodings) {
      encoding.maxBitrate = kind === "video" ? CALL_VIDEO_MAX_BITRATE : CALL_AUDIO_MAX_BITRATE;
      if (kind === "video") encoding.maxFramerate = CALL_VIDEO_MAX_FRAME_RATE;
    }
    parameters.encodings = encodings;
    await sender.setParameters(parameters);
    return true;
  } catch {
    return false;
  }
}
