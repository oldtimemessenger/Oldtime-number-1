// This is only a format/role filter, not authentication. Every privileged
// operation must use this same credential against Supabase Storage, which
// verifies its signature/key and permissions. Never substitute a built-in
// admin key after checking a caller's unverified claims.
export function isServerStorageCredential(value) {
  if (typeof value !== "string" || !value || value.length > 4096) return false;
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const payload = value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload));
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}
