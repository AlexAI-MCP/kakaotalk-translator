import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { buildTranslationRequest, parseTranslations, PROMPT_PROFILES, resolveProfile } from "./translation-prompts.mjs";

const DEFAULT_URL = "http://127.0.0.1:8000/v1";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export class ApiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
export function normalizeBaseUrl(value) {
  try {
    if (typeof value !== "string" || value.length > 2048) throw new Error();
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.href.replace(/\/$/, "");
  } catch { throw new ApiError("Enter an HTTP or HTTPS API base URL without credentials, a query, or a fragment.", 400); }
}
export function validateApiConfig(input, previous = {}) {
  const baseUrl = normalizeBaseUrl(input.baseUrl ?? previous.baseUrl ?? DEFAULT_URL);
  const model = input.model ?? previous.model ?? "";
  const promptProfile = input.promptProfile ?? previous.promptProfile ?? "auto";
  if (typeof model !== "string" || model.length > 300 || /[\r\n\u0000]/.test(model)) {
    throw new ApiError("Enter a model ID of at most 300 characters.", 400);
  }
  if (!PROMPT_PROFILES.some((profile) => profile.id === promptProfile)) throw new ApiError("Choose a supported prompt profile.", 400);
  // A saved credential belongs to its endpoint. Never carry it to another URL.
  const apiKey = input.apiKey === undefined
    ? (baseUrl === previous.baseUrl ? previous.apiKey || "" : "")
    : input.apiKey;
  if (typeof apiKey !== "string" || apiKey.length > 4096 || /[\r\n\u0000]/.test(apiKey)) {
    throw new ApiError("Enter a valid API key without line breaks.", 400);
  }
  return { baseUrl, model: model.trim(), promptProfile, apiKey: apiKey.trim() };
}
export function loadApiConfig(file) {
  try { return validateApiConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch { return validateApiConfig({}); }
}
export function saveApiConfig(file, config) {
  if (!file) return;
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    throw new ApiError("Could not save API settings. Check the settings folder permissions.", 500);
  }
}
export function publicApiConfig(config) {
  return { baseUrl: config.baseUrl, model: config.model, promptProfile: config.promptProfile,
    resolvedProfile: resolveProfile(config.model, config.promptProfile), hasApiKey: Boolean(config.apiKey),
    configured: Boolean(config.model), profiles: PROMPT_PROFILES };
}
export async function apiRequest(config, route, { body, signal, timeoutMs = 90_000, fetcher = fetch } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const headers = { Accept: "application/json" };
    if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetcher(config.baseUrl + "/" + route, {
      method: body ? "POST" : "GET", headers, ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal, redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status;
      throw new ApiError(status === 401 || status === 403 ? "API authentication failed. Check the API key."
        : status === 429 ? "The API rate limit was reached. Try again later."
        : status === 404 ? "API route or model not found. Check the base URL and model ID."
        : status === 400 || status === 422 ? "The API rejected the request. Check the model and prompt profile."
        : `The API returned HTTP ${status}.`, status);
    }
    if (!response.body || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ApiError("The API response is empty or too large.");
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) throw new ApiError("The API response is too large.");
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new ApiError("The API returned an unsupported JSON response."); }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    // Upstream error text can contain keys, URL tokens, or chat content.
    throw new ApiError(controller.signal.aborted ? "The API request was cancelled or timed out."
      : "Could not connect to the API. Check the address and that the server is running.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
export async function listModels(config, options = {}) {
  const result = await apiRequest(config, "models", { timeoutMs: 15_000, ...options });
  if (!Array.isArray(result?.data)) throw new ApiError("The API did not return an OpenAI-compatible model list.");
  return [...new Set(result.data.flatMap((model) =>
    typeof model?.id === "string" && model.id.trim() && model.id.length <= 300 ? [model.id] : []))]
    .sort((a, b) => a.localeCompare(b));
}
export async function translateApiBatch(config, texts, target, { kind, ...options } = {}) {
  if (!config.model) throw new ApiError("Choose an API model in Settings first.", 400);
  const result = await apiRequest(config, "chat/completions", {
    ...options, body: buildTranslationRequest(config, texts, target, kind),
  });
  const choice = result?.choices?.[0];
  const translations = choice?.finish_reason === "length" ? null : parseTranslations(choice?.message?.content, texts.length);
  if (!translations) throw new ApiError("The model did not return a complete translation array. Try another model or prompt profile.");
  const usage = {};
  for (const key of ["prompt_tokens", "completion_tokens", "total_tokens"]) {
    if (Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0) usage[key] = result.usage[key];
  }
  return { translations, reportedModel: typeof result.model === "string" ? result.model.slice(0, 300) : null, usage };
}
export async function translateWithApi(config, texts, target, options = {}) {
  return (await translateApiBatch(config, texts, target, options)).translations;
}
