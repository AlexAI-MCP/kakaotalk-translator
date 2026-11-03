import test from "node:test";
import assert from "node:assert/strict";
import { createChatNameTranslator } from "../lib/chat-names.mjs";

test("English room labels preserve originals and batch only unique Korean names", async () => {
  const calls = [];
  const translator = createChatNameTranslator(async (names, engine) => {
    calls.push({ names, engine });
    return ["Study Group", "Min-su"];
  });
  const originals = ["공부 모임", "English room", "민수", "공부 모임"];
  assert.deepEqual(await translator.labels(originals, "selected"), {
    "공부 모임": "Study Group", "민수": "Min-su",
  });
  assert.deepEqual(calls, [{ names: ["공부 모임", "민수"], engine: "selected" }]);
  assert.deepEqual(originals, ["공부 모임", "English room", "민수", "공부 모임"]);
  await translator.labels(originals, "selected");
  assert.equal(calls.length, 1, "browsing again uses cached labels");
  assert.equal(translator.get("공부 모임", "selected"), "Study Group");
  assert.equal(translator.get("공부 모임", "other"), null, "engine caches are separate");
});

test("disabled translation makes no provider calls", async () => {
  const translator = createChatNameTranslator(() => assert.fail("translation is disabled"));
  assert.deepEqual(await translator.labels(["공부 모임"], "none"), {});
  assert.deepEqual(await translator.labels(["공부 모임"], "demo"), {});
});

test("concurrent room-label requests share a batch", async () => {
  let finish;
  let calls = 0;
  const translator = createChatNameTranslator(() => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const first = translator.labels(["공부 모임"], "selected");
  const second = translator.labels(["공부 모임"], "selected");
  await Promise.resolve();
  finish(["Study Group"]);
  assert.deepEqual(await first, await second);
  assert.equal(calls, 1);
});

test("failed or invalid translations leave originals available and can be retried", async () => {
  let result;
  const translator = createChatNameTranslator(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  for (result of [new Error("Provider unavailable"), [], ["공부 모임"], [""], [42]]) {
    await assert.rejects(translator.labels(["공부 모임"], "selected"));
    assert.equal(translator.get("공부 모임", "selected"), null);
  }
  result = ["Study Group"];
  assert.deepEqual(await translator.labels(["공부 모임"], "selected"), { "공부 모임": "Study Group" });
});
