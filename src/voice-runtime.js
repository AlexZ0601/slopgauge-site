// Runtime for the essay checker's voice comparison: LUAR (Rivera-Soto et al. 2021, Apache-2.0),
// exported by scripts/voice/export_luar.py, run with ONNX Runtime Web in the visitor's browser.
// Bundled into js/vendor/voice-runtime.js by scripts/voice/build-runtime.mjs. The model and the
// runtime are files on slopgauge.com; the text never leaves the page.
import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/wasm';

const BASE = new URL('../../models/voice/', import.meta.url);
ort.env.wasm.wasmPaths = new URL('./', import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

let ready = null;
let tokenizer = null;
let session = null;

// Fetch with progress, so the page can show "Loading the voice model: 40%".
async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total) return new Uint8Array(await res.arrayBuffer());
  const out = new Uint8Array(total);
  const reader = res.body.getReader();
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, at);
    at += value.length;
    if (onProgress) onProgress(at / total);
  }
  return out.subarray(0, at);
}

function load(onProgress) {
  ready ??= (async () => {
    const [tj, tc] = await Promise.all([fetch(new URL('tokenizer.json', BASE)).then((r) => r.json()), fetch(new URL('tokenizer_config.json', BASE)).then((r) => r.json())]);
    tokenizer = new Tokenizer(tj, tc);
    const bytes = await fetchBytes(new URL('onnx/model.onnx', BASE), onProgress);
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// LUAR reads a writer's texts as an "episode" of short pieces, 32 tokens each (30 plus <s> and </s>).
const PIECE = 30;
const MAX_PIECES = 64;
function pieces(texts) {
  const out = [];
  for (const t of texts) {
    const ids = tokenizer.encode(t, { add_special_tokens: false }).ids;
    for (let i = 0; i < ids.length && out.length < MAX_PIECES * texts.length; i += PIECE) {
      // Decode and re-encode, as in training and calibration.
      const piece = tokenizer.decode(ids.slice(i, i + PIECE));
      out.push(tokenizer.encode(piece, { add_special_tokens: true }).ids.slice(0, 32));
    }
  }
  return out.length ? out : [[0, 2]];
}

/** embed(texts) -> Float32Array(512), unit length: the style of these texts, read as one writer's. */
async function embed(texts) {
  await load();
  const ps = pieces(Array.isArray(texts) ? texts : [texts]).slice(0, 512);
  const n = ps.length;
  const ids = new BigInt64Array(n * 32).fill(1n); // <pad>
  const mask = new BigInt64Array(n * 32);
  ps.forEach((p, i) => p.forEach((id, j) => {
    ids[i * 32 + j] = BigInt(id);
    mask[i * 32 + j] = 1n;
  }));
  const out = await session.run({ input_ids: new ort.Tensor('int64', ids, [n, 32]), attention_mask: new ort.Tensor('int64', mask, [n, 32]) });
  const v = out.style.data;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return Float32Array.from(v, (x) => x / norm);
}

const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

self.SlopgaugeVoiceNet = { load, embed, cosine };
