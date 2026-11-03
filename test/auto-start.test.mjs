import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const between = (start, end) => html.slice(html.indexOf(start), html.indexOf(end));

function autoStartContext() {
  const requests = [];
  let browseClicks = 0, error = null;
  const classes = new Set();
  const nodes = {
    browse: { click() { browseClicks++; } },
    "workspace-controls": { classList: { add: (c) => classes.add(c) } },
    "settings-toggle": { setAttribute() {} },
  };
  const context = vm.createContext({
    $: (id) => nodes[id],
    api: async (route, body) => { requests.push({ route, body }); return { running: true }; },
    applyState() {}, showError: (message) => { error = message; },
    window: { matchMedia: () => ({ matches: false }) },
  });
  vm.runInContext("let autoStartDone = false;\n" + between("async function autoStart(state)", "async function tick()"), context);
  return { context, requests, get browseClicks() { return browseClicks; }, get error() { return error; } };
}
const live = { platform: "darwin", kakaocli: true };

test("a saved room starts reading automatically as an auto start", async () => {
  const t = autoStartContext();
  assert.equal(await t.context.autoStart({ running: false, chat: "Saved room", chatId: "1", available: live }), true);
  assert.equal(JSON.stringify(t.requests), JSON.stringify([{ route: "/api/start", body: { auto: true } }]));
  assert.equal(t.browseClicks, 0);
});

test("first run with no saved room opens the room picker instead of starting", async () => {
  const t = autoStartContext();
  assert.equal(await t.context.autoStart({ running: false, chat: "", chatId: null, available: live }), false);
  assert.equal(t.requests.length, 0);
  assert.equal(t.browseClicks, 1);
});

test("auto start does nothing when already running or the reader is unavailable", async () => {
  for (const state of [
    { running: true, chat: "Saved room", available: live },
    { running: false, chat: "Saved room", available: { platform: "darwin", kakaocli: false } },
    { running: false, chat: "Saved room", available: { platform: "linux", kakaocli: true } },
  ]) {
    const t = autoStartContext();
    assert.equal(await t.context.autoStart(state), false);
    assert.equal(t.requests.length, 0);
    assert.equal(t.browseClicks, 0);
  }
});

test("demo mode auto starts without a reader", async () => {
  const t = autoStartContext();
  assert.equal(await t.context.autoStart({ running: false, demo: true, chat: "Sample workspace", available: {} }), true);
  assert.equal(t.requests[0].route, "/api/start");
});

test("picking a room starts reading with a manual start (no translation hold)", async () => {
  const element = () => ({ hidden: true, disabled: false, textContent: "", value: "", children: [],
    setAttribute() {}, replaceChildren() { this.children = []; }, append(...c) { this.children.push(...c); },
    appendChild(c) { this.children.push(c); }, focus() {} });
  const nodes = Object.fromEntries(["browse", "chats", "chat-status", "chat"].map((id) => [id, element()]));
  const requests = [];
  let error = null;
  const context = vm.createContext({
    $: (id) => nodes[id], selectedChatId: null, lastState: { agent: "none" }, chatPickerGeneration: 0, running: false,
    api: async (route, body) => { requests.push({ route, body });
      return route === "/api/chats" ? { chats: [{ id: "999999999999999999", display_name: "Sample room", member_count: 4 }] } : { running: true }; },
    applyState: (state) => { context.running = state.running; },
    saveConfig: async () => {}, tick: async () => {}, showError: (message) => { error = message; },
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: element, addEventListener() {} },
  });
  vm.runInContext(between("function closeChatPicker()", "function applyTheme(theme)"), context);
  await nodes.browse.onclick();
  await nodes.chats.children[0].onclick();
  assert.ok(!error, error);
  assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify({ route: "/api/start", body: {} }));
});
