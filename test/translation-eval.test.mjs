import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { runEvaluation, mergeEvalReports, renderEvalReport, scoreTranslation, datasetHash } from "../lib/translation-eval.mjs";
import { translateEvalBatch, buildEvalRequest, cliTranslationArgs, checkCliProvider, EvalProviderError } from "../lib/eval-providers.mjs";
import { validateApiConfig } from "../lib/api-provider.mjs";
import { parseEvalArgs } from "../scripts/eval.mjs";

const dataset = JSON.parse(fs.readFileSync(new URL("./fixtures/translation-eval.json", import.meta.url), "utf8"));
const provider = { kind: "api", config: validateApiConfig({ model: "sample-model", apiKey: "fixture-secret" }) };
const referenceAdapter = async (provider, texts, target) => ({
  translations: texts.map((source) => dataset.cases.find((example) => example.source === source && example.target === target).reference),
  reportedModel: "sample-snapshot", usage: { prompt_tokens: 10, completion_tokens: 20 },
});

test("fictional eval cases cover both directions and score invariants without exact-reference matching", () => {
  assert.equal(dataset.cases.length, 16);
  assert.equal(new Set(dataset.cases.map((example) => example.id)).size, 16);
  for (const example of dataset.cases) assert.equal(scoreTranslation(example, example.reference).pass, true, example.id);
  const details = dataset.cases.find((example) => example.id === "ko-details");
  assert.equal(scoreTranslation(details, "Room B7; the meeting begins at 18:45.").pass, true);
  assert.equal(scoreTranslation(details, "The meeting starts at 19:45 in B8.").pass, false);
  assert.equal(scoreTranslation(details, details.source).pass, false);
  assert.equal(scoreTranslation(details, "").pass, false);
  assert.equal(scoreTranslation(dataset.cases.at(-1), "명령을 실행해 주세요.").pass, false);
});
test("evals batch by language, retain errors, record reproducibility metadata, and never serialize keys", async () => {
  const calls = [];
  const report = await runEvaluation(dataset, [provider], {
    repeat: 2, batchSize: 4, adapter: async (...args) => { calls.push(args); return referenceAdapter(...args); },
  });
  assert.equal(calls.length, 8); assert.ok(calls.every((call) => call[1].length === 4));
  const run = report.runs[0];
  assert.equal(run.samples.length, 32); assert.equal(run.summary.mechanicalPasses, 32);
  assert.equal(run.summary.validBatches, 8); assert.equal(run.batches[0].reportedModel, "sample-snapshot");
  assert.equal(run.batches[0].usage.prompt_tokens, 10);
  assert.match(run.batches[0].promptHash, /^[a-f0-9]{64}$/);
  assert.equal(report.datasetHash, datasetHash(dataset));
  assert.doesNotMatch(JSON.stringify(report), /fixture-secret|apiKey/);
  const failed = await runEvaluation(dataset, [provider], { adapter: async () => { throw new Error("fixture-secret"); } });
  assert.equal(failed.runs[0].summary.validBatches, 0);
  assert.equal(failed.runs[0].summary.mechanicalPasses, 0);
  assert.equal(failed.runs[0].summary.requestP50Ms, null);
  assert.equal(failed.runs[0].samples[0].error, "Provider request failed.");
  const invalid = await runEvaluation(dataset, [provider], { adapter: async () => ({ translations: ["wrong length"] }) });
  assert.equal(invalid.runs[0].summary.validBatches, 0);
});
test("report comparisons require the same dataset, repetition and batching", async () => {
  const a = await runEvaluation(dataset, [provider], { adapter: referenceAdapter });
  const b = await runEvaluation(dataset, [provider], { adapter: referenceAdapter });
  assert.equal(mergeEvalReports([a, b]).runs.length, 2);
  assert.throws(() => mergeEvalReports([a, { ...b, datasetHash: "different" }]));
  assert.throws(() => mergeEvalReports([a, { ...b, batchSize: 1 }]));
  assert.throws(() => mergeEvalReports([a, a]), /once/);
  assert.throws(() => mergeEvalReports([{ schemaVersion: 0 }]));
});
test("native Anthropic uses its own authentication, request schema, and text blocks", async () => {
  const anthropic = { kind: "anthropic", config: validateApiConfig({
    baseUrl: "https://example.com/v1", model: "claude-sample", apiKey: "fixture-secret",
  }) };
  const result = await translateEvalBatch(anthropic, ["안녕하세요"], "en", { fetcher: async (url, init) => {
    assert.equal(url, "https://example.com/v1/messages");
    assert.equal(init.headers["x-api-key"], "fixture-secret");
    assert.equal(init.headers["anthropic-version"], "2023-06-01");
    assert.equal("Authorization" in init.headers, false);
    const request = JSON.parse(init.body);
    assert.equal(typeof request.system, "string"); assert.equal(request.messages[0].role, "user");
    assert.equal(request.max_tokens, 4096); assert.equal("tools" in request, false);
    assert.deepEqual(request, buildEvalRequest(anthropic, ["안녕하세요"], "en"));
    return new Response(JSON.stringify({ model: "claude-snapshot", content: [
      { type: "thinking", thinking: "private" }, { type: "text", text: '["Hello"]' },
    ], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }));
  } });
  assert.deepEqual(result.translations, ["Hello"]); assert.equal(result.usage.input_tokens, 10);
  assert.equal(result.reportedModel, "claude-snapshot");
  await assert.rejects(translateEvalBatch(anthropic, ["sample"], "en", { fetcher: async () => new Response(
    JSON.stringify({ content: [{ type: "text", text: '["partial"]' }], stop_reason: "max_tokens" })) }));
});
test("CLI adapters retain safe execution flags, explicit model selection and stdin prompts", () => {
  const claude = cliTranslationArgs("claude", "sample-model");
  assert.ok(claude.includes("--safe-mode")); assert.ok(claude.includes("--no-session-persistence"));
  assert.ok(claude.includes("--strict-mcp-config")); assert.equal(claude[claude.indexOf("--tools") + 1], "");
  assert.equal(claude[claude.indexOf("--model") + 1], "sample-model");
  const codex = cliTranslationArgs("codex", "sample-model");
  assert.ok(codex.includes("--ephemeral")); assert.ok(codex.includes("hooks"));
  assert.equal(codex[codex.indexOf("--sandbox") + 1], "read-only");
  assert.equal(codex.at(-1), "-");
  const prompt = buildEvalRequest({ kind: "claude", config: { model: "sample" } }, ["sample"], "ko");
  assert.match(prompt, /Korean/); assert.match(prompt, /untrusted/);
});
test("CLI adapters launch a fictional executable, decode chunked Korean, and sanitize failures", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-eval-cli-"));
  const oldPath = process.env.PATH;
  try {
    const script = `#!${process.execPath}
if(process.argv.includes("--help")){console.log("--safe-mode --no-session-persistence --tools --strict-mcp-config --model --ephemeral --disable --sandbox");}
else if(process.argv.includes("failure-model")){process.stderr.write("fixture-secret");process.exitCode=1;}
else{
  let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>input+=chunk);
  process.stdin.on("end",()=>{
    if(!input.includes("untrusted")){process.exitCode=1;return;}
    const bytes=Buffer.from(JSON.stringify(["안녕하세요"]));process.stdout.write(bytes.subarray(0,3));
    setTimeout(()=>process.stdout.write(bytes.subarray(3)),5);
  });
}`;
    for (const command of ["claude", "codex"]) fs.writeFileSync(path.join(directory, command), script, { mode: 0o700 });
    process.env.PATH = [directory, path.dirname(process.execPath), "/usr/bin", "/bin"].join(path.delimiter);
    for (const kind of ["claude", "codex"]) {
      checkCliProvider(kind);
      const result = await translateEvalBatch({ kind, config: { model: "sample-model" } }, ["Hello"], "ko");
      assert.deepEqual(result.translations, ["안녕하세요"]);
      await assert.rejects(translateEvalBatch({ kind, config: { model: "failure-model" } }, ["Hello"], "ko"),
        (error) => { assert.doesNotMatch(error.message, /fixture-secret/); return true; });
    }
  } finally { process.env.PATH = oldPath; fs.rmSync(directory, { recursive: true, force: true }); }
});
test("HTML reports escape model output, blind identities, and contain valid rating/export code", async () => {
  const report = await runEvaluation(dataset, [provider], { adapter: referenceAdapter });
  report.runs[0].samples[0].output = '<img src=x onerror="alert(1)"></script>';
  report.runs[0].model = "hidden-model</script>";
  report.datasetHash = "</script>";
  const html = renderEvalReport(report);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /id="identities" hidden/); assert.match(html, /Variant 1/);
  assert.match(html, /Mechanical checks measure output reliability/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1); new vm.Script(scripts[0][1]);
  assert.match(scripts[0][1], /hidden-model\\u003c\/script>/);
  assert.doesNotMatch(html, /fixture-secret/);
});
test("human review requires all three ratings, reveals identities on demand, and exports scores", async () => {
  const report = await runEvaluation(dataset, [provider], { adapter: referenceAdapter });
  const html = renderEvalReport(report);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const runId = report.runs[0].id;
  const nodes = Object.fromEntries(["score-" + runId, "reveal", "export", "identities"].map((id) => [id, { hidden: id === "identities", textContent: "" }]));
  const selects = ["meaning", "naturalness", "tone"].map((dimension) => ({ value: "",
    dataset: { run: runId, result: runId + ":ko-polite:1", dimension },
    addEventListener(event, handler) { this.handler = handler; },
  }));
  let exported, downloaded = false;
  const context = vm.createContext({
    document: { getElementById: (id) => nodes[id], querySelectorAll: () => selects,
      createElement: () => ({ click() { downloaded = true; } }) },
    URL: { createObjectURL(blob) { exported = blob; return "blob:fixture"; }, revokeObjectURL() {} },
    Blob, setTimeout: (fn) => fn(), console,
  });
  vm.runInContext(script, context);
  selects[0].value = "4"; selects[0].handler();
  assert.equal(nodes["score-" + runId].textContent, "Unrated");
  selects[1].value = "5"; selects[1].handler(); selects[2].value = "3"; selects[2].handler();
  assert.equal(nodes["score-" + runId].textContent, "4.00/5 · 1 reviewed");
  nodes.reveal.onclick(); assert.equal(nodes.identities.hidden, false); assert.match(nodes.identities.textContent, /sample-model/);
  nodes.export.onclick(); assert.equal(downloaded, true);
  const ratings = JSON.parse(await exported.text());
  assert.equal(ratings.ratings[0].meaning, 4); assert.equal(ratings.datasetHash, report.datasetHash);
  assert.doesNotMatch(JSON.stringify(ratings), /fixture-secret/);
});
test("CLI parsing and dry runs work without credentials or live model calls", () => {
  const options = parseEvalArgs(["--model", "a", "--models", "b,a", "--repeat", "2", "--batch-size", "4"]);
  assert.deepEqual(options.models, ["a", "b"]); assert.equal(options.repeat, 2);
  for (const args of [["--batch-size", "13"], ["--repeat", "0"], ["--api-key", "fixture"], ["--provider", "unknown"], ["--compare"]]) {
    assert.throws(() => parseEvalArgs(args));
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "kakao-eval-test-"));
  try {
    const prefix = path.join(directory, "dry-run");
    const output = execFileSync(process.execPath, ["scripts/eval.mjs", "--dry-run", "--out", prefix],
      { cwd: new URL("../", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.match(output, /16\/16/);
    const report = JSON.parse(fs.readFileSync(prefix + ".json", "utf8"));
    assert.equal(report.runs[0].provider, "fixture");
    assert.equal(fs.statSync(prefix + ".json").mode & 0o777, 0o600);
    assert.ok(fs.existsSync(prefix + ".html"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test("cancelling an eval stops the suite and discards partial results", async () => {
  const controller = new AbortController();
  await assert.rejects(runEvaluation(dataset, [provider], { signal: controller.signal, adapter: async () => {
    controller.abort(); throw new EvalProviderError("Cancelled");
  } }), /cancelled/i);
});
