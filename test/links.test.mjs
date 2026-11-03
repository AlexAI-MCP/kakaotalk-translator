import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const html = fs.readFileSync(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "index.html"), "utf8");
const source = html.match(/function linkParts\(text\) \{[\s\S]*?\n\}\n/)[0];
const linkParts = new Function(`${source}; return linkParts;`)();
const links = (text) => linkParts(text).filter((p) => p.href).map((p) => [p.text, p.href]);

test("chat links become http(s) link parts and the full text is preserved", () => {
  for (const text of ["봐봐 https://youtu.be/dQw4w9WgXcQ ㅋㅋ", "plain text only", "a https://x.io b www.y.com c", ""]) {
    assert.equal(linkParts(text).map((p) => p.text).join(""), text);
  }
  assert.deepEqual(links("봐봐 https://youtu.be/dQw4w9WgXcQ ㅋㅋ"), [["https://youtu.be/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"]]);
  assert.deepEqual(links("https://www.youtube.com/watch?v=abc&t=42s"), [["https://www.youtube.com/watch?v=abc&t=42s", "https://www.youtube.com/watch?v=abc&t=42s"]]);
  assert.deepEqual(links("www.naver.com 확인"), [["www.naver.com", "https://www.naver.com/"]]);
  assert.deepEqual(links("a https://x.io b http://y.io/p"), [["https://x.io", "https://x.io/"], ["http://y.io/p", "http://y.io/p"]]);
});

test("link edges: Korean, punctuation and parentheses end the URL", () => {
  assert.deepEqual(links("https://youtu.be/abc입니다"), [["https://youtu.be/abc", "https://youtu.be/abc"]]);
  assert.deepEqual(links("See https://example.com/a."), [["https://example.com/a", "https://example.com/a"]]);
  assert.deepEqual(links("(https://example.com/a)"), [["https://example.com/a", "https://example.com/a"]]);
  assert.deepEqual(links("https://en.wikipedia.org/wiki/Seoul_(city)"), [["https://en.wikipedia.org/wiki/Seoul_(city)", "https://en.wikipedia.org/wiki/Seoul_(city)"]]);
});

test("unsafe or non-web schemes stay plain text", () => {
  for (const text of ["javascript:alert(1)", "<a href=javascript:alert(1)>x</a>", "data:text/html,hi", "file:///etc/passwd", "mailto:someone", "ftp://x.io"]) {
    assert.deepEqual(links(text), []);
  }
  assert.deepEqual(links('https://x.io/"><img src=x onerror=alert(1)>'), [["https://x.io/", "https://x.io/"]]);
});
