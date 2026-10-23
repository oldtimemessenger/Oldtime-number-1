const MAX_PART_BYTES = 600 * 1024;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

export async function legacyChatArchiveHash(payload) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure archive verification is unavailable in this browser.");
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalValue(payload)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function splitLegacyChatArchive(base, messages, maxBytes = MAX_PART_BYTES) {
  const groups = [];
  let current = [];
  const sizeOf = items => new TextEncoder().encode(JSON.stringify({ ...base, messages: items })).length;
  for (const message of messages) {
    const candidate = [...current, message];
    if (sizeOf(candidate) > maxBytes) {
      if (!current.length) throw new Error("One archived message is too large to transfer safely.");
      groups.push(current);
      current = [message];
      if (sizeOf(current) > maxBytes) throw new Error("One archived message is too large to transfer safely.");
    } else current = candidate;
  }
  if (current.length || !groups.length) groups.push(current);
  if (groups.length > 100) throw new Error("This conversation is too large to transfer in one safe operation.");
  const totalParts = groups.length;
  return Promise.all(groups.map(async (items, part) => {
    const payload = { ...base, messages: items };
    return { sourceId: base.id, part, totalParts, contentHash: await legacyChatArchiveHash(payload), payload };
  }));
}

export async function collectCompleteLegacyChatArchives(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.sourceId !== "string" || !Number.isInteger(row.part) ||
      !Number.isInteger(row.totalParts) || row.totalParts < 1 || row.part < 0 || row.part >= row.totalParts) continue;
    grouped.set(row.sourceId, [...(grouped.get(row.sourceId) || []), row]);
  }
  const archives = [];
  let incomplete = 0;
  for (const [sourceId, parts] of grouped) {
    const totalParts = parts[0]?.totalParts;
    const ordered = [...parts].sort((a, b) => a.part - b.part);
    if (parts.length !== totalParts || ordered.some((part, index) => part.part !== index || part.totalParts !== totalParts)) {
      incomplete++;
      continue;
    }
    let valid = true;
    for (const part of ordered) {
      if (!part.payload || typeof part.payload !== "object" || part.payload.id !== sourceId ||
        part.payload.version !== 1 || !Array.isArray(part.payload.messages) ||
        await legacyChatArchiveHash(part.payload) !== part.contentHash) {
        valid = false;
        break;
      }
    }
    if (!valid) {
      incomplete++;
      continue;
    }
    const first = ordered[0].payload;
    archives.push({
      sourceId,
      payload: { ...first, messages: ordered.flatMap(part => part.payload.messages) },
      totalParts,
      hashes: ordered.map(part => part.contentHash),
    });
  }
  return { archives, incomplete };
}

export const legacyChatArchivePartLimit = MAX_PART_BYTES;
