import { index, jsonb, pgTable, timestamp, uuid, text, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { SportRecording, SportSummary } from "../../../sports/metrics.js";
import { usersTable } from "./accounts";
export const workoutsTable = pgTable("sports_workouts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  recording: jsonb("recording").$type<SportRecording>().notNull(),
  summary: jsonb("summary").$type<SportSummary>().notNull(),
  recordingHash: text("recording_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("sports_workouts_owner_created_idx").on(table.userId, table.createdAt)]);
export const sportsMediaTable = pgTable("sports_media", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  workoutId: uuid("workout_id").notNull().references(() => workoutsTable.id, { onDelete: "cascade" }),
  object: jsonb("object").$type<{ kind: "filesystem" | "s3" | "gcs" | "supabase"; key: string }>().notNull(),
  mime: text("mime").notNull().default("image/jpeg"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertWorkoutSchema = createInsertSchema(workoutsTable);
export type Workout = typeof workoutsTable.$inferSelect;
export const sportsChallengesTable = pgTable("sports_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  activityType: text("activity_type").notNull(),
  goalDistanceM: integer("goal_distance_m").notNull(),
  visibility: text("visibility").notNull().default("invite_only"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
}, t => [index("sports_challenges_creator_idx").on(t.creatorId)]);
export const sportsMembersTable = pgTable("sports_members", {
  challengeId: uuid("challenge_id").notNull().references(() => sportsChallengesTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("invited"),
  joinedAt: timestamp("joined_at", { withTimezone: true }),
}, t => [primaryKey({ columns: [t.challengeId, t.userId] }), index("sports_members_user_idx").on(t.userId)]);
export const sportsWorkoutTagsTable = pgTable("sports_workout_tags", {
  workoutId: uuid("workout_id").primaryKey().references(() => workoutsTable.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  challengeId: uuid("challenge_id").references(() => sportsChallengesTable.id, { onDelete: "cascade" }),
  taggedUserIds: jsonb("tagged_user_ids").$type<string[]>().notNull().default([]),
}, t => [index("sports_workout_tags_challenge_idx").on(t.challengeId)]);
