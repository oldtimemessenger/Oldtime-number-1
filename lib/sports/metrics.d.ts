export interface SportPoint { lat: number; lon: number; timestamp: number; accuracy: number; altitude?: number | null; altitudeAccuracy?: number | null; breakBefore?: boolean }
export interface SportEvent { type: "start" | "pause" | "resume" | "finish"; timestamp: number }
export interface SportRecording { activityType: string; startedAt: number; endedAt?: number | null; points: SportPoint[]; events: SportEvent[] }
export interface SportSummary { distanceM: number; elapsedSeconds: number; activeSeconds: number; movingSeconds: number; paceSecondsPerKm: number | null; speedKmh: number; elevationGainM: number | null; flags: string[] }
export const ACTIVITY_TYPES: string[];
export const MAX_SPEED_METRES_PER_SECOND: Readonly<Record<string, number>>;
export function metres(a: SportPoint, b: SportPoint): number;
export function calculateWorkout(workout: SportRecording, now?: number): SportSummary;
export function routeSegments(workout: SportRecording): SportPoint[][];
export function privateRoute(workout: SportRecording, trimMetres?: number): SportPoint[][];
