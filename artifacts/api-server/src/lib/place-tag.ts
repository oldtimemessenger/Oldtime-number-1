import { z } from "zod/v4";

/** An explicit user-selected label, never an inferred device position. */
export const placeTagSchema = z.object({
  id: z.string().max(128).regex(/^(custom:[a-zA-Z0-9_-]{1,90}|osm:(node|way|relation):[0-9]{1,18})$/),
  label: z.string().trim().min(1).max(140),
  source: z.enum(["custom", "osm"]),
  lat: z.number().finite().min(-90).max(90).optional(),
  lon: z.number().finite().min(-180).max(180).optional(),
}).strict().refine(p => p.source === "custom" ? p.lat === undefined && p.lon === undefined :
  p.lat !== undefined && p.lon !== undefined, "Choose a named place, not a device location.");

export type PlaceTag = z.infer<typeof placeTagSchema>;
