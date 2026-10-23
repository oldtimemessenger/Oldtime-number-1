export const SPORTS_MODE_ENABLED = false;

export function sportsMutationDisabled(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}
