import {defineConfig} from 'vite';
import {resolve} from 'node:path';
// Build the actual production component without development-only React refresh.
export default defineConfig({define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('http://127.0.0.1:3313')},esbuild:{jsx:'automatic'},build:{outDir:'build/fleet-qa',rollupOptions:{input:resolve(process.cwd(),'fleet-preview.html')}}});
