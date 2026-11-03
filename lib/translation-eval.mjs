import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "./api-provider.mjs";
import { EvalProviderError, translateEvalBatch, buildEvalRequest } from "./eval-providers.mjs";
import { resolveProfile } from "./translation-prompts.mjs";

export function datasetHash(dataset) {
  return createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
}
export function scoreTranslation(example, output) {
  const nonempty = typeof output === "string" && output.trim().length > 0;
  const checks = [
    { name: "nonempty", pass: nonempty },
    { name: "target-script", pass: nonempty && (example.target === "ko" ? /[가-힣]/.test(output) : /[A-Za-z]/.test(output) && !/[가-힣]/.test(output)) },
    ...(example.preserve || []).map((token) => ({ name: "preserve " + token, pass: nonempty && output.includes(token) })),
  ];
  if (example.lineBreaks) checks.push({ name: "line breaks", pass: nonempty && (output.match(/\n/g) || []).length >= example.lineBreaks });
  return { pass: checks.every((check) => check.pass), checks };
}
function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]);
}
export function summarizeRun(run) {
  const passed = run.samples.filter((sample) => sample.pass).length;
  const latencies = run.batches.filter((batch) => batch.ok).map((batch) => batch.durationMs);
  return {
    samples: run.samples.length, mechanicalPasses: passed,
    mechanicalPassRate: run.samples.length ? passed / run.samples.length : 0,
    validBatches: run.batches.filter((batch) => batch.ok).length, batches: run.batches.length,
    requestP50Ms: percentile(latencies, 0.5), requestP95Ms: percentile(latencies, 0.95),
    elapsedMs: Math.round(run.batches.reduce((sum, batch) => sum + batch.durationMs, 0)),
  };
}
export async function runEvaluation(dataset, providers, {
  batchSize = 4, repeat = 1, timeoutMs = 90_000, signal, adapter = translateEvalBatch, onProgress = () => {},
} = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12 || !Number.isInteger(repeat) || repeat < 1 || repeat > 10) {
    throw new Error("Use a batch size from 1 to 12 and a repeat count from 1 to 10.");
  }
  const report = { schemaVersion: 1, datasetVersion: dataset.version, datasetHash: datasetHash(dataset),
    cases: dataset.cases, startedAt: new Date().toISOString(), batchSize, repeat, runs: [] };
  for (const provider of providers) {
    const profile = provider.kind === "claude" ? "claude-cli" : provider.kind === "codex" ? "cli"
      : provider.kind === "anthropic" ? "claude" : resolveProfile(provider.config.model, provider.config.promptProfile);
    // Deliberately copy a small allowlist; provider.config contains the API key.
    const run = { id: randomUUID(), provider: provider.kind, model: provider.config.model || "CLI default (unverified)",
      profile, endpoint: ["api", "anthropic"].includes(provider.kind) && provider.config.baseUrl ? new URL(provider.config.baseUrl).origin : null, batches: [], samples: [] };
    for (let iteration = 1; iteration <= repeat; iteration++) {
      for (const target of ["en", "ko"]) {
        const cases = dataset.cases.filter((example) => example.target === target);
        for (let offset = 0; offset < cases.length; offset += batchSize) {
          if (signal?.aborted) throw new Error("Evaluation cancelled.");
          const batch = cases.slice(offset, offset + batchSize);
          const texts = batch.map((example) => example.source);
          const prompt = buildEvalRequest(provider, texts, target);
          const record = { repeat: iteration, target, caseIds: batch.map((example) => example.id),
            promptHash: createHash("sha256").update(JSON.stringify(prompt)).digest("hex"),
            parameters: typeof prompt === "object" ? Object.fromEntries(Object.entries(prompt).filter(([key]) => !["messages", "model", "system"].includes(key))) : {},
            ok: false, durationMs: 0, usage: {}, reportedModel: null };
          onProgress({ model: run.model, provider: run.provider, repeat: iteration, target, caseIds: record.caseIds });
          const start = performance.now();
          let translations = null, error = null;
          try {
            const result = await adapter(provider, texts, target, { timeoutMs, signal });
            if (!Array.isArray(result.translations) || result.translations.length !== batch.length || !result.translations.every((text) => typeof text === "string")) {
              throw new EvalProviderError("The provider returned an invalid translation array.");
            }
            translations = result.translations;
            record.ok = true; record.usage = result.usage || {}; record.reportedModel = result.reportedModel || null;
          } catch (failure) {
            if (signal?.aborted) throw new Error("Evaluation cancelled.");
            error = failure instanceof ApiError || failure instanceof EvalProviderError ? failure.message : "Provider request failed.";
          }
          record.durationMs = Math.round(performance.now() - start); run.batches.push(record);
          for (const [index, example] of batch.entries()) {
            const output = translations?.[index] ?? null;
            const score = scoreTranslation(example, output);
            run.samples.push({ caseId: example.id, repeat: iteration, output, error, ...score });
          }
        }
      }
    }
    run.summary = summarizeRun(run); report.runs.push(run);
  }
  return report;
}
export function mergeEvalReports(reports) {
  if (!reports.length || reports.some((report) => report.schemaVersion !== 1 || !Array.isArray(report.runs) || !Array.isArray(report.cases))) {
    throw new Error("Use evaluation result JSON files created by this runner.");
  }
  const first = reports[0];
  if (reports.some((report) => report.datasetHash !== first.datasetHash || report.batchSize !== first.batchSize ||
    report.repeat !== first.repeat || JSON.stringify(report.cases) !== JSON.stringify(first.cases))) {
    throw new Error("Compare runs with the same dataset, batch size, and repeat count.");
  }
  const ids = reports.flatMap((report) => report.runs.map((run) => run.id));
  if (new Set(ids).size !== ids.length) throw new Error("Each evaluation run can be compared only once.");
  return { ...first, runs: reports.flatMap((report) => report.runs) };
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
export function renderEvalReport(report) {
  // Randomize variant order; names remain hidden during review.
  const variants = report.runs.map((run) => ({ run, order: randomUUID() })).sort((a, b) => a.order.localeCompare(b.order))
    .map(({ run }, index) => ({ run, name: "Variant " + (index + 1) }));
  const identity = variants.map(({ run, name }) => ({ variant: name, id: run.id, provider: run.provider, model: run.model, profile: run.profile }));
  const identityJson = safeJson(identity);
  const rows = variants.map(({ run, name }) => {
    const summary = run.summary;
    return `<tr><td>${name}</td><td>${summary.mechanicalPasses}/${summary.samples}</td><td>${summary.validBatches}/${summary.batches}</td><td>${summary.requestP50Ms ?? "—"} ms</td><td>${summary.requestP95Ms ?? "—"} ms</td><td id="score-${escapeHtml(run.id)}">Unrated</td></tr>`;
  }).join("");
  const cases = report.cases.flatMap((example) => Array.from({ length: report.repeat }, (_, index) => {
    const repetition = index + 1;
    return `<section><h2>${escapeHtml(example.id)} · ${example.target === "en" ? "Korean → English" : "English → Korean"}${report.repeat > 1 ? " · repeat " + repetition : ""}</h2>
<p class="label">Source</p><p class="text">${escapeHtml(example.source)}</p>
<details><summary>Reference &amp; review guidance</summary><p class="text">${escapeHtml(example.reference)}</p><p>${escapeHtml(example.review)}</p><p>Other natural translations may be equally correct.</p></details>
<div class="variants">${variants.map(({ run, name }) => {
  const sample = run.samples.find((item) => item.caseId === example.id && item.repeat === repetition);
  const resultId = run.id + ":" + example.id + ":" + repetition;
  return `<article><h3>${name}</h3><p class="text">${escapeHtml(sample?.output ?? sample?.error ?? "Missing result")}</p>
<p class="check">${sample?.pass ? "Mechanical checks passed" : "Mechanical checks failed"}${sample ? " · " + escapeHtml(sample.checks.filter((check) => !check.pass).map((check) => check.name).join(", ")) : ""}</p>
${["meaning", "naturalness", "tone"].map((dimension) => `<label>${dimension}<select data-run="${escapeHtml(run.id)}" data-result="${escapeHtml(resultId)}" data-dimension="${dimension}" ${sample?.output ? "" : "disabled"}><option value="">Unrated</option>${[1, 2, 3, 4, 5].map((value) => `<option value="${value}">${value}</option>`).join("")}</select></label>`).join("")}</article>`;
}).join("")}</div></section>`;
  })).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Translation evaluation</title>
<style>body{max-width:1200px;margin:32px auto;padding:0 20px;background:#f5f5f1;color:#171918;font:15px/1.6 system-ui,sans-serif}h1{letter-spacing:-.04em}section{border-top:1px solid #aaa;margin-top:28px;padding-top:16px}.variants{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:16px}article{background:white;border:1px solid #ccc;padding:16px}.text{white-space:pre-wrap;overflow-wrap:anywhere}.label,.check{font-size:12px;color:#626660}label{display:block;margin:8px 0;text-transform:capitalize}select,button{padding:8px;margin-left:8px;font:inherit}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ccc}.table-wrap{overflow-x:auto}details{margin:12px 0}summary{cursor:pointer}button{cursor:pointer}.note{max-width:850px}</style>
<h1>Translation evaluation</h1><p>${escapeHtml(report.datasetVersion)} · ${report.cases.length} cases · batch size ${report.batchSize} · ${report.repeat} repeat(s)</p>
<p class="note">Mechanical checks measure output reliability and preserved details, not translation quality. Read the source and rate meaning, naturalness, and tone. Names are hidden until you reveal them. References are illustrative and have not been expert-certified.</p>
<p class="note">Rating scale: 1 = major errors; 3 = usable with noticeable issues; 5 = accurate, natural, and appropriate. Leave uncertain ratings blank. Human averages include only outputs with all three ratings; compare equal coverage.</p>
<p class="note">Latency includes model loading, CLI startup, and network time. p50/p95 use successful requests only; small samples are noisy. Fixture dry runs are synthetic.</p>
<div class="table-wrap"><table><thead><tr><th>Model</th><th>Mechanical pass</th><th>Valid batches</th><th>Request p50</th><th>Request p95</th><th>Human review</th></tr></thead><tbody>${rows}</tbody></table></div>
<p><button id="reveal">Reveal model names</button><button id="export">Export ratings JSON</button></p><div id="identities" hidden></div>${cases}
<script>
const identities=${identityJson};
const ratings={};
function refresh(){
  for(const identity of identities){
    const values=Object.values(ratings).filter(value=>value.runId===identity.id&&["meaning","naturalness","tone"].every(key=>value[key]));
    const average=values.length?values.reduce((sum,value)=>sum+(value.meaning+value.naturalness+value.tone)/3,0)/values.length:null;
    document.getElementById("score-"+identity.id).textContent=average===null?"Unrated":average.toFixed(2)+"/5 · "+values.length+" reviewed";
  }
}
document.querySelectorAll("select").forEach(select=>select.addEventListener("change",()=>{
  const id=select.dataset.result;
  ratings[id] ||= {runId:select.dataset.run,resultId:id};
  ratings[id][select.dataset.dimension]=Number(select.value)||null;refresh();
}));
document.getElementById("reveal").onclick=()=>{
  const box=document.getElementById("identities");box.hidden=!box.hidden;
  box.textContent=identities.map(item=>item.variant+": "+item.provider+" / "+item.model+" / "+item.profile).join(" | ");
};
document.getElementById("export").onclick=()=>{
  const data={schemaVersion:1,datasetHash:${safeJson(report.datasetHash)},identities,ratings:Object.values(ratings),reviewedAt:new Date().toISOString()};
  const link=document.createElement("a");const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  link.href=url;link.download="translation-ratings.local.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
</script></html>`;
}
