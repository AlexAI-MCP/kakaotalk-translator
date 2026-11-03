import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export function findCommand(name) {
  if (name.includes("/") || name.includes("\\")) {
    try { fs.accessSync(name, fs.constants.X_OK); return name; } catch { return null; }
  }
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "which", [name], { encoding: "utf8", timeout: 3000 });
  if (result.status === 0) return result.stdout.trim().split(/\r?\n/)[0];
  if (process.platform !== "win32") {
    for (const dir of [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"]) {
      const candidate = path.join(dir, name);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* continue */ }
    }
  }
  return null;
}
export function cliSupport(name, flags) {
  const command = findCommand(name);
  if (!command) return { installed: false, compatible: false };
  const help = spawnSync(command, name === "codex" ? ["exec", "--help"] : ["--help"], { encoding: "utf8", timeout: 5000 });
  return { installed: true, compatible: help.status === 0 && flags.every((flag) => help.stdout.includes(flag)) };
}
export function readPreferences(file) {
  if (!file) return {};
  try { const data = JSON.parse(fs.readFileSync(file, "utf8")); return data && typeof data === "object" ? data : {}; } catch { return {}; }
}
export function cleanPreferences(input = {}, fallback = {}) {
  const source = { ...fallback, ...input };
  return {
    chat: typeof source.chat === "string" ? source.chat.trim().slice(0, 100) : "",
    chatId: /^\d{1,20}$/.test(String(source.chatId ?? "")) ? String(source.chatId) : null,
    agent: ["none", "claude", "codex", "api", "demo"].includes(source.agent) ? source.agent : "none",
    target: source.target === "ko" ? "ko" : "en",
    intervalSec: Math.max(3, Math.min(5, Number(source.intervalSec) || 4)),
  };
}
