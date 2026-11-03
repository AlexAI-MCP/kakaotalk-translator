import { spawnSync } from "node:child_process";
import { findCommand, cliSupport, appleCommand, appleSupport } from "../lib/runtime.mjs";

console.log("KakaoTalk Translator / environment check");
console.log(`Node: ${process.version} (${Number(process.versions.node.split('.')[0]) >= 18 ? "supported" : "upgrade to Node 18+"})`);
console.log(`Platform: ${process.platform === "darwin" ? "macOS — live reading supported" : process.platform + " — demo only"}`);
const reader = findCommand(process.env.KAKAOCLI || "kakaocli");
console.log(`kakaocli: ${reader ? "found" : "missing — run npm run setup:kakaocli on macOS"}`);
for (const [name, flags] of [["claude",["--safe-mode","--no-session-persistence","--tools","--strict-mcp-config"]],["codex",["--ephemeral","--disable","--sandbox"]]]) {
  const support = cliSupport(name, flags);
  console.log(`${name}: ${support.compatible ? "privacy options available; sign in separately" : support.installed ? "installed but needs an update for privacy options" : "optional, not installed"}`);
}
const apple = appleSupport(appleCommand());
const pack = (s) => s === "installed" ? "installed" : s === "supported" ? "not downloaded; run npm run setup:apple to download, or use the Download button in the viewer" : "unsupported";
console.log(`Apple Translation: ${apple.installed ? `Korean→English ${pack(apple.pairs["ko-en"])}, English→Korean ${pack(apple.pairs["en-ko"])}` : "optional, not installed; run npm run setup:apple (macOS 26+)"}`);
if (process.platform === "darwin" && reader) {
  const result = spawnSync(reader,["chats","--limit","1","--json"],{encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
  if (result.status === 0) {
    try { console.log(`Database read: ${Array.isArray(JSON.parse(result.stdout)) ? "passed" : "unsupported output format"}`); }
    catch { console.log("Database read: unsupported output format"); }
  } else {
    const error = result.stderr || result.stdout || "";
    console.log(/permission|denied|not permitted|full disk/i.test(error)
      ? "Database read: blocked — grant Full Disk Access to your terminal and restart it"
      : "Database read: failed — check KakaoTalk sign-in, local database compatibility, and permissions");
  }
}
console.log("No chat names, message text, account IDs, or credentials were printed.");
console.log("Demo: npm run demo | Live viewer: npm start");
