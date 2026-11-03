import { spawn } from "node:child_process";
import { cliSupport, findCommand } from "./runtime.mjs";
import { ApiError, apiRequest, translateApiBatch } from "./api-provider.mjs";
import { buildTranslationRequest, buildCliTranslationPrompt, parseTranslations } from "./translation-prompts.mjs";

export class EvalProviderError extends Error {}
export function checkCliProvider(provider) {
  const flags = provider === "claude"
    ? ["--safe-mode", "--no-session-persistence", "--tools", "--strict-mcp-config", "--model"]
    : ["--ephemeral", "--disable", "--sandbox", "--model"];
  if (!cliSupport(provider, flags).compatible) {
    throw new EvalProviderError(`Install and sign in to a compatible ${provider} CLI before evaluating it.`);
  }
}
export function cliTranslationArgs(provider, model) {
  const args = provider === "claude"
    ? ["-p", "--safe-mode", "--no-session-persistence", "--tools", "", "--strict-mcp-config",
      "--settings", '{"disableAllHooks":true}']
    : ["exec", "--ephemeral", "--disable", "hooks", "--sandbox", "read-only", "--skip-git-repo-check"];
  if (model) args.push("--model", model);
  if (provider === "codex") args.push("-");
  return args;
}
export function buildEvalRequest(provider, texts, target) {
  if (["claude", "codex"].includes(provider.kind)) return buildCliTranslationPrompt(texts, target, provider.kind);
  const request = buildTranslationRequest(provider.kind === "anthropic"
    ? { ...provider.config, promptProfile: "claude" } : provider.config, texts, target);
  return provider.kind === "anthropic" ? { model: provider.config.model, system: request.messages[0].content,
    messages: [request.messages[1]], max_tokens: 4096 } : request;
}
async function cliBatch(provider, model, texts, target, { signal, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(findCommand(provider) || provider, cliTranslationArgs(provider, model), {
      stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" },
    });
    let output = "", bytes = 0, stopped = false, killTimer;
    const stop = () => {
      stopped = true; child.kill("SIGTERM");
      killTimer ||= setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener("abort", stop); };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk, "utf8");
      if (bytes > 2 * 1024 * 1024) stop();
      else output += chunk;
    });
    // CLI diagnostics may contain account details. Consume them without printing or saving them.
    child.stderr.on("data", () => {});
    child.on("error", () => { cleanup(); reject(new EvalProviderError(`Could not start the ${provider} CLI.`)); });
    child.on("close", (code) => {
      cleanup();
      if (stopped || code !== 0) return reject(new EvalProviderError(`${provider} request failed, timed out, or was cancelled.`));
      const translations = parseTranslations(output, texts.length);
      if (!translations) return reject(new EvalProviderError(`${provider} did not return a complete translation array.`));
      resolve({ translations, reportedModel: null, usage: {} });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buildCliTranslationPrompt(texts, target, provider));
  });
}
export async function translateEvalBatch(provider, texts, target, options = {}) {
  if (provider.kind === "api") return translateApiBatch(provider.config, texts, target, options);
  if (provider.kind === "claude" || provider.kind === "codex") {
    return cliBatch(provider.kind, provider.config.model, texts, target, options);
  }
  if (provider.kind !== "anthropic") throw new EvalProviderError("Unknown evaluation provider.");
  const fetcher = options.fetcher || fetch;
  const response = await apiRequest(provider.config, "messages", {
    ...options,
    body: buildEvalRequest(provider, texts, target),
    fetcher: (url, init) => {
      const headers = { ...init.headers, "anthropic-version": "2023-06-01" };
      delete headers.Authorization;
      if (provider.config.apiKey) headers["x-api-key"] = provider.config.apiKey;
      return fetcher(url, { ...init, headers });
    },
  });
  const content = Array.isArray(response.content) ? response.content.filter((part) => part.type === "text").map((part) => part.text).join("") : "";
  const translations = response.stop_reason === "max_tokens" ? null : parseTranslations(content, texts.length);
  if (!translations) throw new ApiError("Anthropic did not return a complete translation array.");
  const usage = {};
  for (const key of ["input_tokens", "output_tokens"]) {
    if (Number.isSafeInteger(response.usage?.[key]) && response.usage[key] >= 0) usage[key] = response.usage[key];
  }
  return { translations, reportedModel: typeof response.model === "string" ? response.model.slice(0, 300) : null, usage };
}
