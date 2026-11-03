import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function listen(server) {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return server.address().port;
}
async function waitFor(operation) {
  for (let i = 0; i < 100; i++) {
    const value = await operation();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for fictional fixture.");
}
async function startViewer(directory, demo = false) {
  const probe = net.createServer(); const port = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ["server.mjs", "--no-open", ...(demo ? ["--demo"] : [])], {
    cwd: root, env: { ...process.env, KAKAO_LIVE_PORT: String(port), KAKAO_LIVE_AGENT: "none",
      KAKAO_LIVE_SETTINGS_PATH: path.join(directory, "settings.local.json"),
      KAKAO_LIVE_API_SETTINGS_PATH: path.join(directory, "api-provider.local.json") },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  const get = async (route) => (await fetch(base + route)).json();
  const post = (route, body, headers = {}) => fetch(base + route, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Kakao-Live": "1", ...headers },
    body: JSON.stringify(body),
  });
  await waitFor(async () => { try { return (await fetch(base + "/api/state")).ok; } catch { return false; } });
  return { base, get, post, async stop() {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit"); child.kill("SIGTERM");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) { child.kill("SIGKILL"); await exited; }
  } };
}
async function mockProvider() {
  const requests = [];
  const slowResponses = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = { route: req.url, authorization: req.headers.authorization, body: body ? JSON.parse(body) : null };
    requests.push(request);
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/redirect/models") {
      res.writeHead(302, { Location: "/v1/models" }); res.end(); return;
    }
    if (req.url === "/error/models") { res.writeHead(401); res.end('{"error":"fixture-key and private text"}'); return; }
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "gemma-3-4b-it" }, { id: "Qwen3-8B" }] })); return;
    }
    const reply = () => { if (res.destroyed) return; res.end(JSON.stringify({ choices: [{
      finish_reason: "stop", message: { content: JSON.stringify(["Sample translation by " + request.body.model]) },
    }] })); };
    if (request.body?.model === "slow-model") slowResponses.push({ reply, res });
    else reply();
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, slowResponses,
    async stop() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); } };
}

test("settings routes discover models, test samples, protect keys and persist without enabling translation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-api-server-"));
  const provider = await mockProvider();
  let viewer;
  try {
    viewer = await startViewer(directory);
    const page = await (await fetch(viewer.base + "/settings")).text();
    assert.match(page, /Translation settings/); assert.match(page, /type="password"/);
    for (const script of page.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    const index = await (await fetch(viewer.base + "/")).text();
    for (const script of index.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    assert.match(index, /href="\/settings"/); assert.match(index, /option value="api"/);
    const initial = await viewer.get("/api/provider");
    assert.equal(initial.baseUrl, "http://127.0.0.1:8000/v1"); assert.equal(initial.configured, false);
    assert.equal((await viewer.post("/api/config", { agent: "api" })).status, 400);
    assert.equal((await viewer.post("/api/provider/models", {}, { Origin: "https://example.com" })).status, 403);
    assert.equal((await fetch(viewer.base + "/api/provider", { method: "POST" })).status, 403);
    const settings = { baseUrl: provider.baseUrl, model: "gemma-3-4b-it", apiKey: "fixture-key", promptProfile: "auto" };
    const saved = await (await viewer.post("/api/provider", settings)).json();
    assert.equal(saved.hasApiKey, true); assert.equal(saved.resolvedProfile, "gemma");
    assert.equal((await viewer.get("/api/state")).agent, "none");
    assert.doesNotMatch(JSON.stringify(saved), /fixture-key/);
    const file = path.join(directory, "api-provider.local.json");
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await fs.readFile(file, "utf8")).apiKey, "fixture-key");
    const models = await (await viewer.post("/api/provider/models", {})).json();
    assert.deepEqual(models.models, ["gemma-3-4b-it", "Qwen3-8B"]);
    assert.equal(provider.requests.at(-1).authorization, "Bearer fixture-key");
    await viewer.post("/api/provider/models", { baseUrl: provider.baseUrl.replace("/v1", "/other/v1") });
    assert.equal(provider.requests.at(-1).authorization, undefined);
    assert.equal((await viewer.post("/api/provider", { apiKey: "line\nbreak" })).status, 400);
    const preview = await (await viewer.post("/api/provider/preview", {})).json();
    assert.equal(preview.request.messages[0].role, "user");
    assert.doesNotMatch(JSON.stringify(preview), /fixture-key/);
    const sample = await (await viewer.post("/api/provider/test", {})).json();
    assert.match(sample.translation, /gemma-3/);
    assert.match(provider.requests.at(-1).body.messages[0].content, /안녕하세요/);
    const count = provider.requests.length;
    assert.equal((await viewer.post("/api/provider/models", { baseUrl: provider.baseUrl.replace("/v1", "/redirect") })).status, 502);
    assert.equal(provider.requests.length, count + 1, "redirect is not followed");
    const error = await (await viewer.post("/api/provider/models", { baseUrl: provider.baseUrl.replace("/v1", "/error") })).json();
    assert.doesNotMatch(error.error, /fixture-key|private text/);
    await viewer.stop(); viewer = await startViewer(directory);
    assert.equal((await viewer.get("/api/provider")).hasApiKey, true);
    await viewer.post("/api/provider/models", {});
    assert.equal(provider.requests.at(-1).authorization, "Bearer fixture-key");
    await viewer.post("/api/provider", { apiKey: "" });
    assert.equal((await viewer.get("/api/provider")).hasApiKey, false);
  } finally {
    await viewer?.stop(); await provider.stop(); await fs.rm(directory, { recursive: true, force: true });
  }
});

test("the API engine translates fictional demo messages and discards cancelled model results", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kakao-api-demo-"));
  const provider = await mockProvider();
  let viewer;
  try {
    viewer = await startViewer(directory, true);
    const saved = await (await viewer.post("/api/provider", { baseUrl: provider.baseUrl, model: "Qwen3-8B" })).json();
    assert.equal(saved.ephemeral, true);
    await assert.rejects(fs.stat(path.join(directory, "api-provider.local.json")));
    await viewer.post("/api/config", { agent: "api" }); await viewer.post("/api/start", {});
    const first = await waitFor(async () => {
      const data = await viewer.get("/api/messages"); return data.messages.some((m) => m.tstate === "done") ? data : false;
    });
    assert.match(first.messages.find((m) => m.tstate === "done").translation, /Qwen3-8B/);
    const firstRequest = provider.requests.find((request) => request.body?.model === "Qwen3-8B");
    assert.match(firstRequest.body.messages[0].content, /\/no_think/);
    assert.equal(firstRequest.body.temperature, 0.7);
    await viewer.post("/api/stop", {});
    await viewer.post("/api/provider", { model: "slow-model" });
    await viewer.post("/api/config", { chat: "Another fictional room" });
    await viewer.post("/api/start", {});
    await waitFor(() => provider.slowResponses.length);
    await viewer.post("/api/provider", { model: "gemma-4-31b-it" });
    const after = await waitFor(async () => {
      const data = await viewer.get("/api/messages"); return data.messages.some((m) => m.tstate === "done") ? data : false;
    });
    assert.match(after.messages.find((m) => m.tstate === "done").translation, /gemma-4/);
    assert.equal(after.state.lastError, null);
    provider.slowResponses[0].reply();
    await viewer.post("/api/stop", {});
    const stopped = await viewer.get("/api/messages");
    assert.equal(stopped.state.running, false);
    assert.equal(stopped.messages.some((m) => m.translation?.includes("slow-model")), false);
    assert.equal(provider.requests.find((request) => request.body?.model === "gemma-4-31b-it").body.messages[0].role, "system");
  } finally {
    await viewer?.stop(); await provider.stop(); await fs.rm(directory, { recursive: true, force: true });
  }
});
