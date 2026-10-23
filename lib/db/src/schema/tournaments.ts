import { pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { usersTable } from "./accounts";

export type TournamentStanding = {
  id: string; name: string; teamId: string | null; participantId: string | null;
  score: number; percentage: number; rank: number;
  members: { id: string; username: string; displayName: string; avatarUrl: null }[];
};
export const tournamentsTable = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  hostId: uuid("host_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  rules: text("rules").notNull(),
  category: text("category").notNull().default("community"),
  coverTheme: text("cover_theme").notNull().default("arena"),
  hostingType: text("hosting_type").notNull(),
  visibility: text("visibility").notNull(),
  scoringMethod: text("scoring_method").notNull().default("community_support"),
  supportEnabled: boolean("support_enabled").notNull().default(true),
  openToParticipants: boolean("open_to_participants").notNull().default(true),
  maxParticipants: integer("max_participants"),
  goal: integer("goal").notNull(),
  featuredUserId: uuid("featured_user_id").references(() => usersTable.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  finalResults: jsonb("final_results").$type<TournamentStanding[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("tournaments_host_idx").on(t.hostId), index("tournaments_ends_idx").on(t.endsAt)]);
export const tournamentTeams = pgTable("tournament_teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  captainId: uuid("captain_id").references(() => usersTable.id),
}, t => [uniqueIndex("tournament_teams_name_unique").on(t.tournamentId, t.name)]);
export const tournamentParticipants = pgTable("tournament_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  role: text("role").notNull().default("competitor"),
  status: text("status").notNull().default("invited"),
  teamId: uuid("team_id").references(() => tournamentTeams.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  responseMessage: text("response_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("tournament_participant_unique").on(t.tournamentId, t.userId), index("tournament_participants_user_idx").on(t.userId)]);
export const tournamentSupports = pgTable("tournament_supports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  participantId: uuid("participant_id").notNull().references(() => tournamentParticipants.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("tournament_support_unique").on(t.tournamentId, t.userId)]);
export const tournamentAudit = pgTable("tournament_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => usersTable.id),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("tournament_audit_tournament_idx").on(t.tournamentId, t.createdAt)]);
export const tournamentNotifications = pgTable("tournament_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientId: uuid("recipient_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "set null" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournamentsTable.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  essential: boolean("essential").notNull().default(true),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("tournament_notifications_recipient_event_unique").on(t.recipientId, t.eventKey),
  index("tournament_notifications_recipient_created_idx").on(t.recipientId, t.createdAt)]);
export const tournamentNotificationPreferences = pgTable("tournament_notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  nonEssentialEnabled: boolean("non_essential_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
