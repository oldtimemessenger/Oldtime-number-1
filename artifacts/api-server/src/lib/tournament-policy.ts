import { z } from "zod/v4";

export const tournamentInput = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(5).max(2000),
  rules: z.string().trim().min(5).max(3000),
  hostingType: z.enum(["self", "person", "friend", "team", "community"]),
  visibility: z.enum(["public", "private", "invite_only"]),
  category: z.enum(["fitness", "community", "gaming", "creative", "learning", "sports", "other"]).default("community"),
  coverTheme: z.enum(["arena", "ember", "circuit", "grid", "spotlight"]).default("arena"),
  scoringMethod: z.enum(["community_support", "participant_entries"]).default("community_support"),
  supportEnabled: z.boolean().default(true),
  openToParticipants: z.boolean().default(true),
  maxParticipants: z.number().int().min(2).max(500).nullable().default(null),
  durationMinutes: z.number().int().min(15).max(43200),
  startsAt: z.iso.datetime({ offset: true }),
  goal: z.number().int().min(1).max(100000),
  featuredUserId: z.uuid().optional(),
  teamNames: z.array(z.string().trim().min(2).max(40)).min(2).max(8).optional(),
}).strict().superRefine((v, ctx) => {
  if (["person", "friend"].includes(v.hostingType) && !v.featuredUserId) ctx.addIssue({ code: "custom", path: ["featuredUserId"], message: "Choose the person to invite." });
  if (v.hostingType === "team" && (!v.teamNames || new Set(v.teamNames.map(n => n.toLowerCase())).size !== v.teamNames.length))
    ctx.addIssue({ code: "custom", path: ["teamNames"], message: "Add two to eight distinct team names." });
  if (!["person", "friend"].includes(v.hostingType) && v.featuredUserId) ctx.addIssue({ code: "custom", path: ["featuredUserId"], message: "Choose Featuring a person or Friend challenge for an invited competitor." });
  if (v.hostingType !== "team" && v.teamNames) ctx.addIssue({ code: "custom", path: ["teamNames"], message: "Choose the team format first." });
  if (v.scoringMethod === "participant_entries" && v.supportEnabled) ctx.addIssue({ code: "custom", path: ["supportEnabled"], message: "Participant-entry scoring does not use supporter contributions." });
  if (v.visibility !== "public" && v.openToParticipants) ctx.addIssue({ code: "custom", path: ["openToParticipants"], message: "Private and invitation-only tournaments require invitations." });
});
export const tournamentSettingsInput = tournamentInput.partial().omit({
  hostingType: true, featuredUserId: true, teamNames: true,
}).strict().superRefine((v, ctx) => {
  if (v.scoringMethod === "participant_entries" && v.supportEnabled === true) ctx.addIssue({ code: "custom", path: ["supportEnabled"], message: "Participant-entry scoring does not use supporter contributions." });
  if (v.visibility !== undefined && v.visibility !== "public" && v.openToParticipants === true)
    ctx.addIssue({ code: "custom", path: ["openToParticipants"], message: "Private and invitation-only tournaments require invitations." });
});
export type TournamentState = {
  cancelledAt: Date | null; completedAt: Date | null; publishedAt: Date | null; startsAt: Date; endsAt: Date;
};
export function tournamentStatus(t: TournamentState, now: Date) {
  if (t.cancelledAt) return "cancelled";
  if (t.completedAt || now >= t.endsAt) return "completed";
  if (!t.publishedAt) return "awaiting_consent";
  return now < t.startsAt ? "upcoming" : "active";
}
export function competitionRank<T extends { id: string; score: number }>(entries: T[]): (T & { rank: number })[] {
  let rank = 0, lastScore = -1;
  return [...entries].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((entry, i) => {
    if (entry.score !== lastScore) rank = i + 1;
    lastScore = entry.score;
    return { ...entry, rank };
  });
}
export class TournamentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
