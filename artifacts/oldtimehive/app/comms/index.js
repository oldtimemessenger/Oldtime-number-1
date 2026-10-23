import { openVoiceNote, closeVoiceNote, voiceBody, bindVoice } from "./voice-notes.js";
import { maintainSignalConnection } from "./signaling.js";

let tick = null;

export function mountComms() {
  // Keep the shared socket alive for chat and notification updates.
  // Voice and video calls are not mounted in Oldtime.
  if (!tick) tick = setInterval(() => maintainSignalConnection(), 1000);
}

export { openVoiceNote, closeVoiceNote, voiceBody, bindVoice };
