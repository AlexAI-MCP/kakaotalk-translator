import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("function fmtClock(value)"), html.indexOf("function render(message)"));

function el(message) {
  const classes = new Set();
  return { message, dataset: {}, classes, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } };
}
function layout(messages) {
  const items = messages.map(el);
  const context = vm.createContext({ $: () => ({ children: items }) });
  vm.runInContext(code, context);
  context.regroup();
  return items;
}
const at = (iso) => new Date(iso).toISOString();

test("consecutive messages from one sender share a name and the time shows once per minute", () => {
  const [a, b, c, d] = layout([
    { author: "sh", sentAt: at("2026-11-03T15:10:01+09:00") },
    { author: "sh", sentAt: at("2026-11-03T15:10:20+09:00") },
    { author: "sh", sentAt: at("2026-11-03T15:11:05+09:00") },
    { author: "Hue", sentAt: at("2026-11-03T15:11:30+09:00") },
  ]);
  assert.ok(a.classes.has("group-start") && a.classes.has("new-day"));
  assert.ok(a.dataset.day);
  assert.ok(!b.classes.has("group-start") && !b.classes.has("new-day"));
  assert.ok(!c.classes.has("group-start"));
  assert.ok(a.classes.has("time-hidden"), "same sender, same minute follows");
  assert.ok(!b.classes.has("time-hidden"), "last of its minute shows the time");
  assert.ok(!c.classes.has("time-hidden"), "next message is another sender");
  assert.ok(d.classes.has("group-start"));
});

test("a long pause or a new day starts a new group with a date divider", () => {
  const [, b, c] = layout([
    { author: "sh", sentAt: at("2026-11-03T15:10:00+09:00") },
    { author: "sh", sentAt: at("2026-11-03T15:30:00+09:00") },
    { author: "sh", sentAt: at("2026-11-05T09:00:00+09:00") },
  ]);
  assert.ok(b.classes.has("group-start") && !b.classes.has("new-day"));
  assert.ok(c.classes.has("group-start") && c.classes.has("new-day"));
});
