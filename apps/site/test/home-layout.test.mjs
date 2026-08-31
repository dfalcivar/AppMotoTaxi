import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const home = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/landing-home.css", import.meta.url), "utf8");

test("mantiene la HOME aprobada y ubica únicamente los bloques nuevos", () => {
  const flow = home.indexOf('class="v2-flow"');
  const audience = home.indexOf('class="v2-audience"');
  const safety = home.indexOf('class="v2-safety"');
  const coverage = home.indexOf('class="v2-coverage"');
  const advertising = home.indexOf('class="v2-advertising"');
  const earlyAccess = home.indexOf('class="v2-early-access"');
  const faq = home.indexOf('class="v2-faq"');

  assert.ok(flow < audience && audience < safety);
  assert.ok(coverage < advertising && advertising < earlyAccess && earlyAccess < faq);
  assert.equal((home.match(/class="v2-audience-option/g) ?? []).length, 4);
  assert.equal((home.match(/class="v2-audience-illustration/g) ?? []).length, 4);
  assert.match(home, /Soy parte de una cooperativa de movilidad/);
  assert.doesNotMatch(home, /v2-audience-icon/);
});

test("usa una sola imagen generada para el mapa costero y conserva Costi", () => {
  assert.match(home, /landing-coverage-atacames-integrated-v5\.webp/);
  assert.doesNotMatch(home, /v2-map-route|v2-map-label/);
  assert.match(home, /commercial-assistant-launcher/);
  assert.match(home, /commercial-assistant-panel/);
  assert.match(styles, /\.landing-v2 \.v2-audience/);
  assert.match(styles, /\.landing-v2 \.v2-early-access/);
  assert.doesNotMatch(styles, /\.v2-audience-icon/);
});
