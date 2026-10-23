import { z } from "zod";
import { calculateWorkout } from "../../../../lib/sports/metrics.js";
const point = z.object({
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
  timestamp: z.number().int().positive(), accuracy: z.number().min(0).max(1000),
  altitude: z.number().min(-500).max(9000).nullable().optional(),
  altitudeAccuracy: z.number().min(0).max(1000).nullable().optional(),
  breakBefore: z.boolean().optional(),
}).strict();
export const recordingSchema = z.object({
  activityType: z.enum(["run", "walk", "cycle", "hike"]),
  startedAt: z.number().int().positive(), endedAt: z.number().int().positive().nullable(),
  points: z.array(point).max(5000),
  events: z.array(z.object({ type: z.enum(["start", "pause", "resume", "finish"]), timestamp: z.number().int().positive() }).strict()).min(1).max(2000),
}).strict().superRefine((w, ctx) => {
  const fail = () => ctx.addIssue({ code: "custom", message: "Recording timestamps, events or point order are invalid." });
  const finished = w.events.at(-1)?.type === "finish";
  const recordingLimit = w.endedAt ?? Date.now() + 60000;
  if ((finished !== (w.endedAt !== null)) || recordingLimit <= w.startedAt ||
    recordingLimit - w.startedAt > 48 * 3600000 || recordingLimit > Date.now() + 60000 ||
    w.events[0].type !== "start" || w.events[0].timestamp !== w.startedAt ||
    finished && w.events.at(-1)?.timestamp !== w.endedAt) { fail(); return; }
  let running = true, last = w.startedAt;
  const windows: [number, number][] = []; let windowStart = w.startedAt;
  for (let i = 1; i < w.events.length; i++) {
    const e = w.events[i];
    if (e.timestamp < last || e.timestamp > recordingLimit || e.type === "start" ||
      e.type === "resume" && running || e.type === "pause" && !running ||
      e.type === "finish" && i !== w.events.length - 1) { fail(); return; }
    if (e.type === "pause" || e.type === "finish") { if (running) windows.push([windowStart, e.timestamp]); running = false; }
    if (e.type === "resume") { running = true; windowStart = e.timestamp; }
    last = e.timestamp;
  }
  if (running) windows.push([windowStart, recordingLimit]);
  last = -1;
  for (const p of w.points) {
    if (p.timestamp <= last || !windows.some(([a, b]) => p.timestamp >= a && p.timestamp <= b)) { fail(); return; }
    last = p.timestamp;
  }
});
export { calculateWorkout };
