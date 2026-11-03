import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { validateApiConfig, publicApiConfig } from "../lib/api-provider.mjs";
import { buildTranslationRequest } from "../lib/translation-prompts.mjs";

test("settings form discovers/selects models, clears draft keys on URL changes, and keeps save separate from enable", async () => {
  const html = fs.readFileSync(new URL("../settings.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  const element = () => ({ value: "", textContent: "", hidden: false, checked: false, disabled: false, children: [],
    replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ""; },
    appendChild(child) { this.children.push(child); } });
  const nodes = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map((match) => [match[1], element()]));
  const requests = [];
  const timers = new Map();
  let nextTimer = 0, failModels = false;
  let config = validateApiConfig({ model: "gemma-3-4b-it", apiKey: "fixture-key" });
  const context = vm.createContext({
    URL, console,
    Option: function(text, value) { return { textContent: text, value }; },
    document: { getElementById: (id) => nodes[id], querySelectorAll: () => Object.values(nodes) },
    setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (route, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      requests.push({ route, body });
      let result;
      if (route === "/api/provider/models") {
        if (failModels) return new Response(JSON.stringify({ error: "Connection unavailable." }), { status: 502 });
        result = { models: ["gemma-3-4b-it", "Qwen3-8B"] };
      } else if (route === "/api/provider/preview") {
        const candidate = validateApiConfig(body, config);
        result = { profile: publicApiConfig(candidate).resolvedProfile, request: buildTranslationRequest(candidate, ["Fictional sample"]) };
      } else if (route === "/api/provider/test") {
        result = { translation: "Fictional translation", profile: "gemma" };
      } else {
        if (body) config = validateApiConfig(body, config);
        result = { ...publicApiConfig(config), ephemeral: false };
      }
      return new Response(JSON.stringify(result));
    },
  });
  vm.runInContext(script, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes["api-key"].value, "");
  assert.match(nodes["key-help"].textContent, /key is saved/);
  assert.equal(nodes.profile.value, "auto");
  assert.match(nodes["profile-help"].textContent, /Gemma/);
  assert.equal(nodes["profile-source"].hidden, false);
  await nodes["load-models"].onclick();
  assert.equal(nodes["model-list"].children.length, 3);
  nodes["model-list"].value = "Qwen3-8B"; nodes["model-list"].onchange();
  assert.equal(nodes.model.value, "Qwen3-8B");
  nodes["api-key"].value = "draft-key";
  nodes["openai-preset"].onclick();
  assert.equal(nodes["base-url"].value, "https://api.openai.com/v1");
  assert.equal(nodes["api-key"].value, "", "draft key is not carried to a new provider");
  await nodes["load-models"].onclick();
  assert.equal("apiKey" in requests.at(-1).body, false);
  nodes["api-key"].value = "replacement-fixture-key";
  await nodes["provider-form"].onsubmit({ preventDefault() {} });
  assert.equal(nodes["api-key"].value, "", "key input is cleared after save");
  assert.match(nodes.status.textContent, /Settings saved/);
  assert.equal(requests.some((request) => request.route === "/api/config"), false, "saving does not select an engine");
  await nodes["test-api"].onclick();
  assert.equal(nodes.sample.hidden, false); assert.match(nodes.sample.textContent, /Fictional translation/);
  nodes["clear-key"].checked = true;
  await nodes["provider-form"].onsubmit({ preventDefault() {} });
  assert.equal(config.apiKey, "");
  assert.equal(nodes["clear-key"].checked, false);
  failModels = true;
  await nodes["load-models"].onclick();
  assert.equal(nodes.status.textContent, "Connection unavailable.");
  assert.equal(nodes["load-models"].disabled, false);
});
