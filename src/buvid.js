import fs from 'node:fs';
import path from 'node:path';
import { getJson, adoptFromResponse, DATA_DIR } from './http.js';

const BUV = path.join(DATA_DIR, 'buvid.json');

// Single-flight buvid bootstrap. GET /x/frontend/finger/spi returns data.b_3/b_4.
// We persist b_3 & b_4 and share them across API calls to reduce risk control.
function loadPersisted() {
  if (fs.existsSync(BUV)) {
    try { return JSON.parse(fs.readFileSync(BUV, 'utf8')); } catch { /* ignore */ }
  }
  return null;
}

function persist(data) {
  fs.writeFileSync(BUV, JSON.stringify(data, null, 2), 'utf8');
}

let current = null;
let currentExpiry = 0;

export async function ensureBuvidJar(jar, force = false) {
  const now = Date.now();
  if (!force && current && currentExpiry > now) {
    return current;
  }

  const persisted = loadPersisted();
  if (!force && persisted && persisted.b_3 && persisted.b_4 && persisted.expiresAt > now) {
    current = { b_3: persisted.b_3, b_4: persisted.b_4 };
    currentExpiry = persisted.expiresAt;
    applyToJar(jar, persisted.b_3, persisted.b_4);
    return current;
  }

  const url = 'https://api.bilibili.com/x/frontend/finger/spi';
  const res = await getJson(url, { referer: 'https://www.bilibili.com' });
  adoptFromResponse(res, jar);

  let b3 = null, b4 = null;
  if (res.json && res.json.data) {
    b3 = res.json.data.b_3;
    b4 = res.json.data.b_4;
  }
  const fallback = { b_3: `buvid3=${fallbackBuvid()}`, b_4: '' };
  if (!b3) b3 = fallback.b_3;

  const expiresAt = now + 24 * 3600 * 1000;
  current = { b_3: b3, b_4: b4 || '' };
  currentExpiry = expiresAt;
  persist({ b_3: b3, b_4: b4 || '', expiresAt });
  applyToJar(jar, b3, b4 || '');
  return current;
}

function applyToJar(jar, b3, b4) {
  const all = jar.all;
  if (b3) all[extractBuvidName(b3)] = extractBuvidValue(b3);
  if (b4) all[extractBuvidName(b4)] = extractBuvidValue(b4);
  jar.setAll(all);
}

function extractBuvidName(pair) { return pair.includes('=') ? pair.slice(0, pair.indexOf('=')) : pair; }
function extractBuvidValue(pair) { return pair.includes('=') ? pair.slice(pair.indexOf('=') + 1) : ''; }

function fallbackBuvid() {
  // Random hex, similar to bilibili's generated buvid3 format.
  const hex = [...cryptoRandom(16)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex}infoc`;
}
function cryptoRandom(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}