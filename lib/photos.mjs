const MAX_BYTES = 20 * 1024 * 1024;
export function photoUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "talk.kakaocdn.net" ||
        url.port || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
export function parsePhotos(attachment) {
  let data;
  try { data = typeof attachment === "string" ? JSON.parse(attachment) : attachment; }
  catch { return []; }
  if (!data || typeof data !== "object") return [];
  const originals = Array.isArray(data.imageUrls) ? data.imageUrls : [data.url];
  const thumbnails = Array.isArray(data.thumbnailUrls) ? data.thumbnailUrls : [data.thumbnailUrl];
  return originals.slice(0, 30).flatMap((source, i) => {
    const original = photoUrl(source);
    const preview = photoUrl(thumbnails[i]) || original;
    return original && preview ? [{ original, preview }] : [];
  });
}
// One IN list per chat and chunk: a long OR chain exceeds SQLite's expression depth limit (1000).
export function photoQueries(rows, chunkSize = 500) {
  const byChat = new Map();
  for (const m of rows) {
    const chatId = String(m.chatId), logId = String(m.logId);
    if (!/^\d+$/.test(chatId) || !/^\d+$/.test(logId)) continue;
    if (!byChat.has(chatId)) byChat.set(chatId, new Set());
    byChat.get(chatId).add(logId);
  }
  return [...byChat].flatMap(([chatId, ids]) => {
    const logIds = [...ids];
    return Array.from({ length: Math.ceil(logIds.length / chunkSize) }, (_, i) =>
      `SELECT chatId,logId,attachment FROM NTChatMessage WHERE type IN (2,27) AND chatId=${chatId} AND logId IN (${logIds.slice(i * chunkSize, (i + 1) * chunkSize).join(",")})`);
  });
}
export async function fetchPhoto(source, fetcher = fetch) {
  const url = photoUrl(source);
  if (!url) throw new Error("Unavailable photo.");
  const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Unavailable photo.");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error("Photo is too large.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  const bytes = Buffer.concat(chunks);
  // Check the actual file signature; never serve HTML or active SVG from attachments.
  const type = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()) ? "image/gif"
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  if (!type) throw new Error("Unsupported photo format.");
  return { bytes, type };
}
