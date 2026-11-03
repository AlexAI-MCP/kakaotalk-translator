import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { ApiError, loadApiConfig, validateApiConfig } from "../lib/api-provider.mjs";
import { EvalProviderError, checkCliProvider } from "../lib/eval-providers.mjs";
import { runEvaluation, mergeEvalReports, renderEvalReport } from "../lib/translation-eval.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const HELP = `Translation eval — fictional Korean ↔ English cases

  npm run eval -- --models MODEL_A,MODEL_B
  npm run eval -- --provider api --base-url https://api.openai.com/v1 --api-key-env OPENAI_API_KEY --models MODEL
  npm run eval -- --provider anthropic --models MODEL
  npm run eval -- --provider claude --models MODEL
  npm run eval -- --provider codex --models MODEL
  npm run eval -- --compare RUN_A.json RUN_B.json
  npm run eval -- --dry-run

Options:
  --models IDs           Comma-separated model IDs; --model ID can be repeated.
  --provider NAME        api (default), anthropic, claude, or codex.
  --base-url URL         API base URL; defaults to saved API settings.
  --api-key-env NAME     Read a key from this environment variable; never put keys in arguments.
  --profile ID           API prompt profile (default: saved profile).
  --batch-size N         Messages per request, 1–12 (default: 4).
  --repeat N             Repeat each case, 1–10 (default: 1).
  --timeout-seconds N    Per-request timeout, 1–600 (default: 90).
  --out PREFIX          Output PREFIX.json and PREFIX.html (default: artifacts/evals/unique-run).
  --compare FILES        Merge compatible result JSON files without model requests.
  --dry-run             Use references as synthetic outputs; no model calls or credentials.
  --help                Show this help.

The API runner reuses api-provider.local.json read-only. Endpoint changes do not
reuse its key. Native Anthropic defaults to ANTHROPIC_API_KEY and /v1/messages.
Claude/Codex use your already-authenticated CLI with tools/hooks restricted as
in the viewer. Hosted runs can consume API or subscription usage.
`;
export function parseEvalArgs(args) {
  const options = { provider: "api", models: [], compare: [], batchSize: 4, repeat: 1, timeoutSeconds: 90 };
  const valueFlags = { "--provider": "provider", "--base-url": "baseUrl", "--api-key-env": "keyEnv",
    "--profile": "profile", "--out": "out", "--batch-size": "batchSize", "--repeat": "repeat",
    "--timeout-seconds": "timeoutSeconds" };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" || flag === "-h") options.help = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--compare") {
      while (args[index + 1] && !args[index + 1].startsWith("--")) options.compare.push(args[++index]);
      if (!options.compare.length) throw new EvalProviderError("Pass result JSON files after --compare.");
    } else if (flag === "--models" || flag === "--model" || valueFlags[flag]) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new EvalProviderError("A command option is missing its value. Use --help.");
      if (flag === "--models") options.models.push(...value.split(",").map((model) => model.trim()).filter(Boolean));
      else if (flag === "--model") options.models.push(value);
      else options[valueFlags[flag]] = value;
    } else throw new EvalProviderError("Unknown command option. Use --help.");
  }
  if (!["api", "anthropic", "claude", "codex"].includes(options.provider)) throw new EvalProviderError("Choose api, anthropic, claude, or codex.");
  for (const [key, max] of [["batchSize", 12], ["repeat", 10], ["timeoutSeconds", 600]]) {
    options[key] = Number(options[key]);
    if (!Number.isInteger(options[key]) || options[key] < 1 || options[key] > max) throw new EvalProviderError("Invalid batch size, repeat count, or timeout.");
  }
  if (options.keyEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.keyEnv)) throw new EvalProviderError("Enter a valid API key environment-variable name.");
  options.models = [...new Set(options.models)];
  if (options.models.length > 10) throw new EvalProviderError("Compare at most 10 models per run.");
  return options;
}
function providersFor(options) {
  if (options.dryRun) return [{ kind: "fixture", config: { model: "Reference fixture (synthetic)", promptProfile: "generic" } }];
  let config;
  if (options.provider === "anthropic") {
    const keyName = options.keyEnv || "ANTHROPIC_API_KEY";
    if (!process.env[keyName]) throw new EvalProviderError("Set the Anthropic key environment variable before running.");
    config = validateApiConfig({ baseUrl: options.baseUrl || "https://api.anthropic.com/v1", apiKey: process.env[keyName],
      promptProfile: "claude" });
  } else if (options.provider === "api") {
    const saved = loadApiConfig(process.env.KAKAO_LIVE_API_SETTINGS_PATH || path.join(ROOT, "api-provider.local.json"));
    const input = { ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.profile ? { promptProfile: options.profile } : {}) };
    if (options.keyEnv) {
      if (!process.env[options.keyEnv]) throw new EvalProviderError("Set the requested API key environment variable before running.");
      input.apiKey = process.env[options.keyEnv];
    }
    config = validateApiConfig(input, saved);
  } else {
    checkCliProvider(options.provider);
    config = validateApiConfig({ model: "" });
  }
  const models = options.models.length ? options.models : config.model ? [config.model] : ["claude", "codex"].includes(options.provider) ? [""] : [];
  if (!models.length) throw new EvalProviderError("Pass --models or choose a model in API settings first.");
  return models.map((model) => ({ kind: options.provider, config: validateApiConfig({ model }, config) }));
}
async function main() {
  const options = parseEvalArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  let report;
  if (options.compare.length) {
    const reports = options.compare.map((file) => {
      if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error("An evaluation result file is too large.");
      return JSON.parse(fs.readFileSync(file, "utf8"));
    });
    report = mergeEvalReports(reports);
  } else {
    const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, "test/fixtures/translation-eval.json"), "utf8"));
    const providers = providersFor(options);
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once("SIGINT", abort); process.once("SIGTERM", abort);
    try {
      report = await runEvaluation(dataset, providers, {
        batchSize: options.batchSize, repeat: options.repeat, timeoutMs: options.timeoutSeconds * 1000, signal: controller.signal,
        ...(options.dryRun ? { adapter: async (provider, texts, target) => ({
          translations: texts.map((text) => dataset.cases.find((example) => example.source === text && example.target === target).reference),
          reportedModel: "synthetic fixture", usage: {},
        }) } : {}),
        onProgress: (event) => console.error(`${event.provider} / ${event.model}: repeat ${event.repeat}, target ${event.target}, ${event.caseIds.length} messages`),
      });
    } finally { process.removeListener("SIGINT", abort); process.removeListener("SIGTERM", abort); }
  }
  const prefix = options.out ? path.resolve(options.out) : path.join(ROOT, "artifacts/evals",
    "run-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
  fs.mkdirSync(path.dirname(prefix), { recursive: true, mode: 0o700 });
  const files = [[prefix + ".json", JSON.stringify(report, null, 2) + "\n"], [prefix + ".html", renderEvalReport(report)]];
  for (const [file, content] of files) { fs.writeFileSync(file, content, { mode: 0o600 }); fs.chmodSync(file, 0o600); }
  console.table(report.runs.map((run) => ({ provider: run.provider, model: run.model, profile: run.profile,
    mechanical: `${run.summary.mechanicalPasses}/${run.summary.samples}`,
    validBatches: `${run.summary.validBatches}/${run.summary.batches}`, requestP50Ms: run.summary.requestP50Ms })));
  console.log("Mechanical checks are not quality scores. Open the HTML report for blind human review.");
  console.log("Results: " + files[0][0]); console.log("Review: " + files[1][0]);
  if (report.runs.some((run) => run.summary.mechanicalPasses !== run.summary.samples)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof ApiError || error instanceof EvalProviderError ? error.message :
      "Evaluation could not finish. Check provider settings, input files, or --help. No provider diagnostics were saved.");
    process.exitCode = 1;
  });
}
