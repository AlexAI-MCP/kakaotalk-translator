import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("photo posts use opaque IDs, serve previews/originals, and expire on room changes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-photo-test-"));
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const cli = path.join(directory, "fixture-reader");
  // Fictional data only: no real database, chat content or network calls.
  await fs.writeFile(cli, `#!${process.execPath}
const args = process.argv.slice(2);
const source = "https://talk.kakaocdn.net/fictional/";
if (args[0] === "messages") console.log(JSON.stringify([
  { chat_id: "9007199254740993", id: "9007199254740995", text: "Photo", sender: "Sample", timestamp: "2026-01-01T00:00:00Z" },
  { chat_id: "9007199254740993", id: "9007199254740997", text: "Album", sender: "Sample", timestamp: "2026-01-01T00:00:01Z" }
]));
else if (args[0] === "query" && args[1].includes("attachment")) {
  if (!args[1].includes("chatId=9007199254740993 AND logId IN (9007199254740995,9007199254740997)")) process.exit(1);
  console.log(JSON.stringify([
    ["9007199254740993", "9007199254740995", JSON.stringify({ url: source+"original.jpg", thumbnailUrl: source+"preview.jpg" })],
    ["9007199254740993", "9007199254740997", JSON.stringify({ imageUrls: [source+"second.jpg", source+"expired.jpg"] })]
  ]));
} else console.log("[]");
`, { mode: 0o700 });
  const bootstrap = path.join(directory, "bootstrap.mjs");
  await fs.writeFile(bootstrap, `
Object.defineProperty(process, "platform", { value: "darwin" });
globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith("https://talk.kakaocdn.net/fictional/") || options.redirect !== "error") throw new Error("Unexpected request");
  if (url.endsWith("expired.jpg")) return new Response("", { status: 404 });
  const bytes = Buffer.concat([Buffer.from("ffd8ffe0", "hex"), Buffer.from(url.endsWith("preview.jpg") ? "preview" : "original")]);
  return new Response(bytes);
};
await import(${JSON.stringify(path.join(root, "server.mjs"))});
`);
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1"); await once(probe, "listening");
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, [bootstrap, "--no-open"], {
    cwd: root, env: { ...process.env, KAKAOCLI: cli, KAKAO_LIVE_PORT: String(port),
      KAKAO_LIVE_SETTINGS_PATH: path.join(directory, "preferences.json"),
      KAKAO_LIVE_AGENT: "none", KAKAO_LIVE_CHAT: "Sample",
      PATH: path.dirname(process.execPath) },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const post = (route, data) => fetch(base + route, { method: "POST",
    headers: { "X-Kakao-Live": "1", "Content-Type": "application/json" }, body: JSON.stringify(data) });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = (await fetch(base + "/api/state")).ok; if (ready) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready);
    await post("/api/start", {});
    let result;
    for (let i = 0; i < 60; i++) {
      result = await (await fetch(base + "/api/messages")).json();
      if (result.messages.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[0].photos.length, 1);
    assert.equal(result.messages[1].photos.length, 2);
    assert.doesNotMatch(JSON.stringify(result), /kakaocdn|fictional\/|thumbnailUrl/);
    const id = result.messages[0].photos[0].id;
    const preview = await fetch(base + "/api/photo?id=" + id);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("Content-Type"), "image/jpeg");
    assert.equal(preview.headers.get("Cache-Control"), "no-store");
    assert.match(Buffer.from(await preview.arrayBuffer()).toString(), /preview/);
    const original = await fetch(base + "/api/photo?id=" + id + "&full=1");
    assert.match(Buffer.from(await original.arrayBuffer()).toString(), /original/);
    assert.equal((await fetch(base + "/api/photo?id=" + id,
      { headers: { Origin: "https://example.com" } })).status, 403);
    assert.equal((await fetch(base + "/api/photo?id=" + result.messages[1].photos[1].id)).status, 502);
    assert.equal((await fetch(base + "/api/photo?id=unknown")).status, 404);
    await post("/api/stop", {});
    await post("/api/config", { chat: "Another sample" });
    assert.equal((await fetch(base + "/api/photo?id=" + id)).status, 404);
  } finally {
    const exited = once(child, "exit"); child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    await fs.rm(directory, { recursive: true, force: true });
  }
});
