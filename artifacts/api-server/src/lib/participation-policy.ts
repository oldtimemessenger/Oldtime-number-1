import { z } from "zod/v4";
import { placeTagSchema } from "./place-tag";

export const boardInput = z.object({
  prompt: z.string().trim().min(3).max(180),
  format: z.enum(["photo", "video", "text", "mixed"]).default("mixed"),
  category: z.enum(["creative", "sports", "music", "places", "friends", "funny"]).default("creative"),
  visibility: z.enum(["public", "invite_only", "private"]).default("invite_only"),
  rules: z.string().trim().max(1000).default(""),
  commentsEnabled: z.boolean().default(true),
}).strict();
export const entryInput = z.object({
  id: z.string().uuid(),
  caption: z.string().trim().max(2000).default(""),
  place: placeTagSchema.nullable().optional(),
}).strict();
export function canReadBoard(board: { creatorId: string; visibility: string }, viewer: string, invited: boolean, blocked = false) {
  return !blocked && (board.creatorId === viewer || board.visibility === "public" || board.visibility === "invite_only" && invited);
}
export function acceptsEntry(format: string, type: string, caption: string) {
  return (format === "mixed" || format === type) && (type !== "text" || !!caption.trim());
}
export const entryUpdateInput = z.object({
  caption: z.string().trim().max(2000).optional(),
  place: placeTagSchema.nullable().optional(),
  removed: z.boolean().optional(),
  pinned: z.boolean().optional(),
}).strict().refine(value => Object.keys(value).length > 0);
export function canUpdateEntry(fields: Record<string, unknown>, author: boolean, manager: boolean) {
  return Object.keys(fields).every(key => key === "caption" || key === "place" ? author : key === "pinned" || key === "removed" ? manager : false);
}
