import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("room labels use the selected engine, stay English and preserve room selection", { skip: process.platform !== "darwin" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chat-labels-"));
  const probe = net.createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const executable = (name, code) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, `#!${process.execPath}\n${code}`, { mode: 0o700 });
    return file;
  };
  const reader = executable("reader", `console.log(JSON.stringify([{id:"999999999999999999",display_name:"공부 모임",member_count:4}]));`);
  executable("codex", `
    if (process.argv.includes("--help")) { console.log("--ephemeral --disable --sandbox"); }
    else {
      let input = "";
      process.stdin.on("data", (data) => input += data);
      process.stdin.on("end", () => {
        require("node:fs").appendFileSync(${JSON.stringify(path.join(directory, "prompts"))}, input + "\\n");
        console.log('["Study Group"]');
      });
    }
  `);
  const child = spawn(process.execPath, ["server.mjs", "--no-open"], {
    cwd: new URL("../", import.meta.url),
    env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH, KAKAOCLI: reader,
      KAKAO_LIVE_PORT: String(port), KAKAO_LIVE_AGENT: "none", KAKAO_LIVE_SETTINGS_PATH: path.join(directory, "settings.json") },
    stdio: "ignore",
  });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(base + "/api/state")).ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const post = async (route, body) => {
      const response = await fetch(base + route, { method: "POST",
        headers: { "X-Kakao-Live": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const id = "999999999999999999";
    await fetch(base + "/api/chats");
    assert.deepEqual((await post("/api/chat-names", { ids: [id] })).body.chats, [{ id, english_name: null }]);
    assert.equal(fs.existsSync(path.join(directory, "prompts")), false, "translation off sends no names");
    assert.equal((await post("/api/config", { agent: "codex", target: "ko", chat: "공부 모임", chatId: id })).status, 200);
    assert.deepEqual((await post("/api/chat-names", { ids: [id] })).body.chats, [{ id, english_name: "Study Group" }]);
    const state = await (await fetch(base + "/api/state")).json();
    assert.equal(state.chat, "공부 모임");
    assert.equal(state.chatId, id);
    assert.equal(state.chatEnglishName, "Study Group");
    const rooms = await (await fetch(base + "/api/chats")).json();
    assert.equal(rooms.chats[0].display_name, "공부 모임");
    assert.equal(rooms.chats[0].english_name, "Study Group");
    await post("/api/chat-names", { ids: [id] });
    const prompt = fs.readFileSync(path.join(directory, "prompts"), "utf8");
    assert.equal(prompt.match(/Translate these Korean chatroom titles/g).length, 1, "cached labels avoid another provider call");
    assert.match(prompt, /concise English/);
    assert.equal((await post("/api/chat-names", { ids: ["arbitrary text"] })).status, 400);
    assert.deepEqual((await post("/api/chat-names", { ids: ["123"] })).body.chats, []);
  } finally {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
    if (child.exitCode === null) child.kill("SIGKILL");
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
