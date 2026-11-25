import { test } from "node:test";
import assert from "node:assert/strict";
import { CSV_BOM, csvCell, csvLine } from "./csv";

test("a text cell that could run as a formula is guarded, whatever it starts with", () => {
  for (const bad of ["=SUM(A1)", "+cmd", "-1+2", "@evil", "\tx", "\rx"]) assert.equal(csvCell(bad).startsWith("\"'"), true, JSON.stringify(bad));
  assert.equal(csvCell("+923001234567"), '"+923001234567"', "a phone number is text, not a formula");
  assert.equal(csvCell('a "b"'), '"a ""b"""');
  assert.equal(csvCell("ORD-1"), '"ORD-1"');
});

test("numbers are numbers, nothing is an empty quoted cell, lines end with CRLF, and the BOM is one character", () => {
  assert.equal(csvCell(-120), "-120");
  assert.equal(csvCell(0), "0");
  assert.equal(csvCell(Number.NaN), '""');
  assert.equal(csvCell(null), '""');
  assert.equal(csvLine(["a", 1, null]), '"a",1,""\r\n');
  assert.equal(CSV_BOM.charCodeAt(0), 0xfeff);
  assert.equal(CSV_BOM.length, 1);
});
