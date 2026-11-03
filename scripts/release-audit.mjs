import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicPath = /^(server\.mjs|index\.html|README\.md|LICENSE|SECURITY\.md|CONTRIBUTING\.md|package\.json|\.gitignore|settings\.example\.json|lib\/[\w.-]+\.mjs|scripts\/[\w.-]+\.(mjs|sh)|scripts\/kakaocli-(account-detection|chat-names)\.patch|test\/[\w./-]+\.(mjs|json)|test\/reader\/ChatNamesTests\.swift|\.github\/workflows\/[\w.-]+\.yml|docs\/[\w./-]+\.(md|png|svg))$/;
const ignored = /(^|\/)(\.git|node_modules|\.build|\.vendor|artifacts|screenshots|coverage|\.claude|\.codex|\.kakaocli|transcripts|chat-exports)(\/|$)|(^|\/)\.DS_Store$|\.local\.|(^|\/)\.env(?:\.|$)|\.(log|tgz|db|sqlite|jsonl)(?:$|-)/;
function walk(dir, prefix = "") {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry) => {
    const name = prefix + entry.name;
    if (ignored.test(name)) return [];
    if (entry.isSymbolicLink()) return [name];
    return entry.isDirectory() ? walk(path.join(dir,entry.name),name+"/") : [name];
  });
}
const git = spawnSync("git",["ls-files","-z","--cached","--others","--exclude-standard"],{cwd:root,encoding:"utf8"});
const files = [...new Set(git.status === 0 ? git.stdout.split("\0").filter(Boolean) : walk(root))].sort();
const patterns = [
  ["private-key material",/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["provider-key material",/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{25,})\b/],
  ["personal email",/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  ["machine-specific home path",/\/(?:Users|home)\/[A-Za-z0-9._-]+/],
];
let failed = false;
for (const name of files) {
  if (!publicPath.test(name) || ignored.test(name) || fs.lstatSync(path.join(root,name)).isSymbolicLink()) {
    console.log(`BLOCKED: unexpected/private candidate file ${name}`);failed=true;continue;
  }
  if (/\.(png)$/.test(name)) continue;
  const text = fs.readFileSync(path.join(root,name),"utf8");
  for (const [label,regex] of patterns) if (regex.test(text)) {
    console.log(`BLOCKED: ${label} in ${name} (matched text hidden)`);failed=true;
  }
}
if (!files.length) { console.log("BLOCKED: no public candidate files found");failed=true; }
console.log(`${failed ? "FAIL" : "PASS"}: ${files.length} candidate files checked. Local preferences, DBs and transcripts must remain untracked.`);
console.log("This is a heuristic check, not a guarantee. Review the staged diff before publishing. This check does not publish anything.");
process.exitCode = failed ? 1 : 0;
