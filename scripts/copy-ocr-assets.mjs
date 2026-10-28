import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

await mkdir('public/ocr', { recursive: true });
await copyFile('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const file of await readdir('node_modules/tesseract.js-core')) {
  if (/\.wasm(?:\.js)?$/.test(file)) await copyFile(resolve('node_modules/tesseract.js-core', file), resolve('public/ocr', file));
}
console.log('Local OCR worker and WebAssembly assets prepared. Language data downloads on first use.');
