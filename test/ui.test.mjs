// DiliBownload frontend UI regression test (jsdom).
// NOTE: splits @ registered in package.json. Run with: npm test
// It loads public/index.html + public/app.js, stubs fetch, drives the
// DownKyi-style picker and asserts the generated download links.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
const mockResolve = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'resolve-sample.json'), 'utf8'));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'http://localhost:40031/',
  resources: 'usable',
});
const { window } = dom;
const { document } = window;

// jsdom has no Response; return plain objects implementing .json().
function res(obj, status = 200) {
  return { status, json: () => Promise.resolve(obj) };
}
window.fetch = async (url) => {
  if (url.includes('/api/login/status')) return res({ ok: true, isLogin: true, uname: '测试' });
  if (url.includes('/api/resolve')) return res(mockResolve);
  return res({ ok: true });
};
window.eval(appSrc);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('picker: three dropdowns render with correct options', async () => {
  await sleep(200);
  document.getElementById('url-input').value = 'https://www.bilibili.com/video/BV1U7V66FEiK';
  document.getElementById('resolve-btn').click();
  await sleep(300);

  const qSel = document.getElementById('p0-quality');
  assert.ok(qSel, '画质 dropdown rendered');
  const qVals = [...qSel.options].map((o) => o.value);
  assert.ok(qVals.includes('v-112') && qVals.includes('v-80') && qVals.includes('v-64'), `画质 options: ${qVals.join(',')}`);
  assert.equal(qVals[0], 'v-112', '画质降序 (1080P 高码率 first)');

  const cSel = document.getElementById('p0-codec');
  assert.ok(cSel, '编码 dropdown rendered');
  const cVals = [...cSel.options].map((o) => o.value);
  assert.ok(cVals.includes('7') && cVals.includes('12') && cVals.includes('13'), `编码 options: ${cVals.join(',')}`);

  const aSel = document.getElementById('p0-audio');
  const aVals = [...aSel.options].map((o) => o.value);
  assert.ok(aVals.includes('a-30280') && aVals.includes('a-30216'), `音质 options: ${aVals.join(',')}`);
});

test('picker: switching 画质 repopulates 编码', async () => {
  const qSel = document.getElementById('p0-quality');
  const cSel = document.getElementById('p0-codec');
  qSel.value = 'v-64';
  qSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(10);
  const cVals = [...cSel.options].map((o) => o.value);
  assert.equal(cVals.length, 1, `720P should have only H264, got ${cVals.join(',')}`);
  assert.equal(cVals[0], '7');
});

test('generate: video + audio + subtitle + cover links', async () => {
  const subCb = document.querySelector('input[data-kind="subtitle"]');
  const coverCb = document.querySelector('input[data-kind="cover"]');
  subCb.checked = true;
  coverCb.checked = true;
  document.querySelector('.gen-btn').click();
  await sleep(10);
  const out = document.getElementById('p0-result').textContent;
  assert.ok(out.includes('https://v.example/720.m4s'), 'video url');
  assert.ok(out.includes('https://a.example/30280.m4s'), 'audio url');
  assert.ok(out.includes('https://s.example/zh.json'), 'subtitle url');
  assert.ok(out.includes('http://i0.hdslb.com/x.jpg'), 'cover url');
  assert.ok(out.includes('视频 720P 高清'), 'video label');
});

test('generate: exact 画质×编码 + audio toggle', async () => {
  const qSel = document.getElementById('p0-quality');
  const cSel = document.getElementById('p0-codec');
  qSel.value = 'v-112';
  qSel.dispatchEvent(new window.Event('change', { bubbles: true }));
  await sleep(10);
  cSel.value = '12';
  document.querySelector('input[data-kind="audio"]').checked = false;
  document.querySelector('.gen-btn').click();
  await sleep(10);
  const out = document.getElementById('p0-result').textContent;
  assert.ok(out.includes('https://v.example/1080h265.m4s'), 'HEVC video url');
  assert.ok(!out.includes('/a.example/'), 'audio excluded when unchecked');
});