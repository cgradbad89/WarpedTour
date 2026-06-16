// Unit tests for the RFC 4180 CSV tokenizer (src/lib/csv.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "@/lib/csv";

test("simple rows and columns", () => {
  assert.deepEqual(parseCsv("a,b,c"), [["a", "b", "c"]]);
  assert.deepEqual(parseCsv("a,b\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
});

test("CRLF and lone CR line endings", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d"), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(parseCsv("a\rb"), [["a"], ["b"]]);
});

test("quoted fields keep commas and newlines", () => {
  assert.deepEqual(parseCsv('"a,b",c'), [["a,b", "c"]]);
  assert.deepEqual(parseCsv('"line1\nline2",b'), [["line1\nline2", "b"]]);
});

test('escaped quotes ("") become a literal quote', () => {
  assert.deepEqual(parseCsv('"she said ""hi""",x'), [['she said "hi"', "x"]]);
});

test("empty fields and trailing commas", () => {
  assert.deepEqual(parseCsv("a,,b"), [["a", "", "b"]]);
  assert.deepEqual(parseCsv("a,b,"), [["a", "b", ""]]);
});

test("BOM is stripped", () => {
  const bom = String.fromCharCode(0xfeff);
  assert.deepEqual(parseCsv(bom + "a,b"), [["a", "b"]]);
});

test("trailing newline does not add a phantom row", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

test("blank interior line is preserved as a single empty cell", () => {
  assert.deepEqual(parseCsv("a\n\nb"), [["a"], [""], ["b"]]);
});

test("empty input yields no rows", () => {
  assert.deepEqual(parseCsv(""), []);
});
