// tools/test-browser-wasm.mjs — optional browser integration test for ffmpeg.wasm.
// Requires: the dev server running (npm start) + a local Chrome or Edge.
// Usage: npm run test:browser
// Verifies the self-hosted @ffmpeg/ffmpeg (from /lib, no CDN) loads in a real
// headless browser and runs a tiny real ffmpeg command producing an mp4.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.TEST_BROWSER_BASE || 'http://localhost:3000';
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];
const browserPath = CANDIDATES.find((p) => fs.existsSync(p));

if (!browserPath) {
  console.error('未找到 Chrome/Edge，跳过浏览器 ffmpeg.wasm 集成测试。');
  process.exit(0);
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  OK   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} :: ${detail}`); }
}

const browser = await puppeteer.launch({
  executablePath: browserPath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
try {
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30000 });
  const out = await page.evaluate(async () => {
    const r = {};
    try {
      const lib = await import('/lib/esm/index.js');
      r.hasFFmpeg = typeof lib.FFmpeg === 'function';
      const ff = new lib.FFmpeg();
      await ff.load({ coreURL: '/lib/ffmpeg-core.esm.js', wasmURL: '/lib/ffmpeg-core.wasm' });
      r.loaded = ff.loaded === true;
      await ff.exec(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=0.2', '-c:v', 'libx264', '-y', 'out.mp4']);
      r.rc = ff.ret;
      const data = await ff.readFile('out.mp4');
      r.bytes = data?.length;
    } catch (e) {
      r.error = (e.message || '') + ' ' + (e.stack || '').slice(0, 200);
    }
    return r;
  });
  console.log('  wasm result:', JSON.stringify(out).slice(0, 300));
  check('ffmpeg.wasm loaded (self-hosted, no CDN)', out.loaded === true, out.error);
  check('real ffmpeg command produced an mp4', (out.bytes || 0) >= 64, `bytes=${out.bytes} rc=${out.rc}`);
} finally {
  await browser.close();
}

console.log(`\n== browser-wasm: ${pass} passed, ${fail} failed ==`);
process.exit(fail > 0 ? 1 : 0);