// Reads dropped or chosen files as plain text, in the browser: .txt/.md as they are, .docx through
// its XML (fflate unzips it), .pdf with PDF.js. Bundled into js/vendor/files-runtime.js by
// scripts/voice/build-runtime.mjs. Nothing is uploaded.
import { unzipSync, strFromU8 } from 'fflate';
import * as pdfjs from 'pdfjs-dist/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', import.meta.url).href;

function docxText(bytes) {
  const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('not a Word document');
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const out = [];
  for (const p of doc.getElementsByTagNameNS(W, 'p')) {
    let line = '';
    for (const n of p.getElementsByTagNameNS(W, '*')) {
      if (n.localName === 't') line += n.textContent;
      else if (n.localName === 'tab') line += '\t';
      else if (n.localName === 'br' || n.localName === 'cr') line += '\n';
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function pdfText(bytes) {
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const content = await (await pdf.getPage(i)).getTextContent();
    let text = '';
    let lastY = null;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = item.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) text += item.hasEOL ? '\n' : ' ';
      text += item.str;
      if (item.hasEOL) text += '\n';
      lastY = y;
    }
    pages.push(text);
  }
  // Join lines broken by the layout; keep blank lines as paragraph breaks.
  return pages.join('\n\n').replace(/[ \t]+\n/g, '\n').replace(/([^\n])\n(?=[^\n])/g, '$1 ').replace(/ {2,}/g, ' ').trim();
}

/** readFile(file) -> { name, text } */
async function readFile(file) {
  const name = file.name || 'text';
  const lower = name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text;
  if (lower.endsWith('.docx')) text = docxText(bytes);
  else if (lower.endsWith('.pdf') || file.type === 'application/pdf') text = await pdfText(bytes);
  else text = new TextDecoder().decode(bytes);
  return { name, text: text.replace(/\r\n?/g, '\n') };
}

self.SlopgaugeFiles = { readFile };
