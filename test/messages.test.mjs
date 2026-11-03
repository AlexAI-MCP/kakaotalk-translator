import test from "node:test";
import assert from "node:assert/strict";
import { parseCliJson,parseMessages,needsTranslation,extractArray } from "../lib/messages.mjs";
import { cleanPreferences } from "../lib/runtime.mjs";

test("64-bit identifiers stay exact and quoted message text is untouched",() => {
  const text='sample "id": 999999999999999999 and 12345';
  const row=parseCliJson('{"id":999999999999999999,"small":5,"text":'+JSON.stringify(text)+'}');
  assert.equal(row.id,"999999999999999999");assert.equal(row.small,5);assert.equal(row.text,text);
});
test("actual kakaocli field names map without displaying sender numbers",() => {
  const [row]=parseMessages('[{"chat_id":999999999999999999,"id":9007199254740993,"sender_id":9007199254740995,"text":"sample","timestamp":"2026-01-01T00:00:00Z"}]');
  assert.equal(row.chatId,"999999999999999999");assert.equal(row.logId,"9007199254740993");assert.equal(row.senderId,"9007199254740995");assert.equal(row.author,"Name unavailable");
});
test("message arrays, objects and NDJSON are supported",() => {
  assert.equal(parseMessages('{"messages":[{"text":"sample"}]}').length,1);
  assert.equal(parseMessages('{"text":"sample"}').length,1);
  assert.equal(parseMessages('{"text":"one"}\n{"text":"two"}').length,2);
  assert.equal(parseMessages("").length,0);
});
test("Korean-only text is translated to English",() => {
  assert.equal(needsTranslation("안녕하세요","en"),true);
  assert.equal(needsTranslation("Hello","en"),false);
  assert.equal(needsTranslation("🙂","en"),false);
});
test("Korean target accepts other scripts but skips Korean-containing text",() => {
  assert.equal(needsTranslation("Hello","ko"),true);
  assert.equal(needsTranslation("こんにちは","ko"),true);
  assert.equal(needsTranslation("مرحبا","ko"),true);
  assert.equal(needsTranslation("안녕하세요 hello","ko"),false);
});
test("translation output must match the batch shape",() => {
  assert.deepEqual(extractArray('```json\n["one","two"]\n```',2),["one","two"]);
  assert.equal(extractArray('["one"]',2),null);assert.equal(extractArray('[{}]',1),null);
});
test("preferences discard extra fields and preserve only configuration",() => {
  const prefs=cleanPreferences({chat:"  Sample  ",chatId:"999999999999999999",agent:"claude",target:"en",intervalSec:100,extra:"not persisted"});
  assert.equal(prefs.chat,"Sample");assert.equal(prefs.chatId,"999999999999999999");assert.equal(prefs.intervalSec,5);assert.equal(prefs.extra,undefined);
  assert.equal(cleanPreferences({agent:"apple"}).agent,"apple");assert.equal(cleanPreferences({agent:"apple; rm"}).agent,"none");
  assert.equal(cleanPreferences({chatId:"1); DROP",agent:"other"}).chatId,null);assert.equal(cleanPreferences().agent,"none");assert.equal(cleanPreferences().chat,"");
});
