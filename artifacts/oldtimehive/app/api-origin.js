const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL?.trim() || "";

function parseApiBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("VITE_API_BASE_URL must be a valid HTTP or HTTPS origin.");
  }

  if (!["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash) {
    throw new Error("VITE_API_BASE_URL must contain only the API server's HTTP or HTTPS origin.");
  }

  if (import.meta.env?.PROD && url.protocol !== "https:") {
    throw new Error("VITE_API_BASE_URL must use HTTPS in production.");
  }

  return url.origin;
}

export function cloudApiUrl(path, baseUrl = API_BASE_URL) {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.includes("\\") || path.startsWith("//")) {
    throw new Error("Cloud API requests must use a same-origin /api/ path.");
  }

  const pathProbe = new URL(path, "https://oldtime-api.invalid");
  if (pathProbe.origin !== "https://oldtime-api.invalid" || !pathProbe.pathname.startsWith("/api/")) {
    throw new Error("Cloud API requests must stay within the /api/ route.");
  }

  const apiOrigin = baseUrl ? parseApiBaseUrl(baseUrl) : "";
  return apiOrigin ? new URL(path, `${apiOrigin}/`).href : path;
}
