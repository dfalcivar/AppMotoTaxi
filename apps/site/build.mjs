import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const current = dirname(fileURLToPath(import.meta.url));
const root = resolve(current, "../..");
const output = resolve(current, "dist");
const googleMapsWebApiKey = (
  process.env.PUBLIC_GOOGLE_MAPS_WEB_API_KEY ??
  process.env.VITE_GOOGLE_MAPS_WEB_API_KEY ??
  ""
).trim();

if (!googleMapsWebApiKey) {
  console.warn(
    "[Costa-Go] PUBLIC_GOOGLE_MAPS_WEB_API_KEY no está configurada; el seguimiento público mostrará el respaldo sin mapa."
  );
}

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, "assets"), { recursive: true });
await cp(resolve(current, "src"), output, { recursive: true });
await writeFile(
  resolve(output, "config.js"),
  `window.COSTA_GO_PUBLIC_CONFIG=${JSON.stringify({
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? "https://mototaxi-atacames-api.onrender.com",
    // Browser-only, referrer-restricted key. Never use the server or Android key here.
    googleMapsWebApiKey,
    googleMapsConfigured: Boolean(googleMapsWebApiKey),
  })};\n`,
  "utf8"
);

for (const page of ["privacy.html", "terms.html", "account-deletion.html", "fares.html"]) {
  await cp(resolve(root, "apps/admin/public", page), resolve(output, page));
}

await cp(
  resolve(root, "apps/admin/public/costa-go-emblem.png"),
  resolve(output, "assets/costa-go-emblem.png")
);
await cp(
  resolve(root, "apps/mobile/assets/images/mototaxi-map-marker.png"),
  resolve(output, "assets/mototaxi-map-marker.png")
);
await cp(
  resolve(root, "docs/google-play/assets/feature-background-source.png"),
  resolve(output, "assets/costa-go-coast.png")
);
await cp(
  resolve(root, "docs/google-play/assets/costa-go-feature-graphic-1024x500.png"),
  resolve(output, "assets/og.png")
);

console.log(`Sitio Costa-Go generado en ${output}`);
