// Bundles the checker's lazily loaded runtimes into js/vendor/: src/voice-runtime.js (tokenizer +
// ONNX Runtime Web, CPU build) and src/files-runtime.js (Word and PDF reading).
//   npm install && npm run build:voice
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'js', 'vendor');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [path.join(ROOT, 'src', 'voice-runtime.js'), path.join(ROOT, 'src', 'files-runtime.js')],
  outdir: OUT,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'linked',
  external: ['node:*', 'fs', 'path', 'url', 'worker_threads'],
  logLevel: 'warning',
});
const ort = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) fs.copyFileSync(path.join(ort, f), path.join(OUT, f));
fs.copyFileSync(path.join(ROOT, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs'), path.join(OUT, 'pdf.worker.min.mjs'));
const size = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
console.log(`js/vendor: ${(size / 1e6).toFixed(1)} MB`);
