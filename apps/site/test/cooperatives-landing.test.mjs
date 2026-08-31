import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../src/cooperativas/index.html", import.meta.url), "utf8");
const home = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../src/cooperativas/cooperativas.js", import.meta.url), "utf8");

test("publica una landing específica para cooperativas de mototaxis", () => {
  assert.match(page, /cooperativas? de mototaxis (?:y|o) tricimotos/i);
  assert.doesNotMatch(page, /ahorro|crédito|préstamo/i);
  assert.equal((page.match(/<article><span>[\s\S]*?<h3>/g) ?? []).length, 3);
  assert.match(home, /href="\/cooperativas\/"/);
});

test("el formulario incluye los campos requeridos y envío idempotente", () => {
  for (const name of ["cooperativeName","contactName","roleTitle","phone","email","city","unitCount","message"]) assert.match(page, new RegExp(`name="${name}"`));
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /cooperative-demo-requests/);
  assert.match(script, /button\.disabled = true/);
});
