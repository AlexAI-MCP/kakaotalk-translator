import { needsTranslation } from "./messages.mjs";

// Cache English labels separately from the original names used to select rooms.
export function createChatNameTranslator(translate) {
  const cache = new Map();
  const pending = new Map();
  const key = (engine, name) => JSON.stringify([engine, name]);
  function get(name, engine) {
    return cache.get(key(engine, name)) || null;
  }
  async function labels(names, engine) {
    if (!engine || engine === "none" || engine === "demo") return {};
    const korean = [...new Set(names.filter((name) => needsTranslation(name, "en")))];
    const missing = korean.filter((name) => !get(name, engine) && !pending.has(key(engine, name)));
    if (missing.length) {
      const batch = Promise.resolve().then(() => translate(missing, engine)).then((english) => {
        if (!Array.isArray(english) || english.length !== missing.length ||
            english.some((name) => typeof name !== "string" || !name.trim() || needsTranslation(name, "en"))) {
          throw new Error("English room labels returned an unsupported format.");
        }
        if (cache.size + missing.length > 1000) cache.clear();
        missing.forEach((name, i) => cache.set(key(engine, name), english[i].trim()));
      }).finally(() => missing.forEach((name) => pending.delete(key(engine, name))));
      missing.forEach((name) => pending.set(key(engine, name), batch));
    }
    await Promise.all(korean.map((name) => pending.get(key(engine, name))));
    return Object.fromEntries(korean.map((name) => [name, get(name, engine)]));
  }
  return { labels, get };
}
