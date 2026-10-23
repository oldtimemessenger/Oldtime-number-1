function normalizeSignalValue(value, seen) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Call signaling data must use finite numbers.");
    return value;
  }
  if (typeof value === "undefined") return undefined;
  if (typeof value !== "object") {
    throw new TypeError("Call signaling data must contain only serializable values.");
  }
  if (seen.has(value)) throw new TypeError("Call signaling data cannot contain circular references.");

  seen.add(value);
  try {
    const jsonValue = typeof value.toJSON === "function" ? value.toJSON() : value;
    if (jsonValue !== value) return normalizeSignalValue(jsonValue, seen);
    if (Array.isArray(value)) {
      return value.map(item => normalizeSignalValue(item, seen) ?? null);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Call signaling objects must provide toJSON().");
    }

    const plain = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizeSignalValue(item, seen);
      if (normalized !== undefined) plain[key] = normalized;
    }
    return plain;
  } finally {
    seen.delete(value);
  }
}

export function serializeSignalData(value) {
  return normalizeSignalValue(value, new WeakSet());
}
