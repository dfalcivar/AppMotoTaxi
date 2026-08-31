import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const page = await readFile(new URL("../src/cooperativas/index.html", import.meta.url), "utf8");
const home = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const script = await readFile(new URL("../src/cooperativas/cooperativas.js", import.meta.url), "utf8");

test("publica una landing específica para cooperativas de mototaxis", () => {
  assert.match(page, /cooperativas? de mototaxis (?:y|o) tricimotos/i);
  assert.doesNotMatch(page, /ahorro|crédito|préstamo/i);
  assert.equal((page.match(/class="pillar-copy"/g) ?? []).length, 3);
  for (const asset of ["cooperatives-intelligence-v1.webp", "cooperatives-operation-v1.webp", "cooperatives-management-v1.webp"]) {
    assert.match(page, new RegExp(`/assets/${asset}`));
  }
  assert.doesNotMatch(page, /<article><span>[▥▣●]<\/span>/);
  const readingAssets = ["drivers", "units", "trips", "hours", "zones", "trends"];
  for (const asset of readingAssets) assert.match(page, new RegExp(`/assets/cooperatives-reading-${asset}-v1\\.webp`));
  assert.doesNotMatch(page, /<article><b>[●▣⌁◷⌖↗]<\/b>/);
  assert.match(page, /cooperatives-platform-team-v1\.webp/);
  assert.match(page, /Conoce cómo Costa-Go convierte la operación de tu cooperativa en información clara para gestionar mejor, identificar oportunidades y tomar decisiones con respaldo de datos\./);
  assert.doesNotMatch(page, /class="coastal-art"/);
  assert.match(home, /href="\/cooperativas\/"/);
});

test("el formulario incluye los campos requeridos y envío idempotente", () => {
  for (const name of ["cooperativeName","contactName","roleTitle","phone","email","city","unitCount","message"]) assert.match(page, new RegExp(`name="${name}"`));
  assert.match(script, /crypto\.randomUUID\(\)/);
  assert.match(script, /cooperative-demo-requests/);
  assert.match(script, /button\.disabled = true/);
});
