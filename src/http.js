import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class CookiesJar {
  // { domainBare -> [{name, value}] }
  constructor(domain = 'bilibili.com') {
    this.domain = domain;
    this.file = path.join(DATA_DIR, 'cookies.json');
    this.store = {};
    ensureDataDir();
    this.load();
  }

  load() {
    if (fs.existsSync(this.file)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      } catch {
        this.store = {};
      }
    }
  }

  persist() {
    ensureDataDir();
    fs.writeFileSync(this.file, JSON.stringify(this.store, null, 2), 'utf8');
  }

  get key() { return this.domain; }

  // Parse a Set-Cookie string list, store, and persist.
  adopt(setCookieHeaders) {
    if (!setCookieHeaders || setCookieHeaders.length === 0) return;
    const cookies = this.store[this.key] || {};
    for (const raw of setCookieHeaders) {
      const first = raw.split(';')[0].trim();
      const eq = first.indexOf('=');
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (name) cookies[name] = value;
    }
    this.store[this.key] = cookies;
    this.persist();
  }

  // Set explicit cookie map (used after QR login lands on crossDomain)
  setAll(cookies) {
    this.store[this.key] = { ...cookies };
    this.persist();
  }

  get all() {
    return this.store[this.key] || {};
  }

  toHeader() {
    const cookies = this.all;
    const parts = Object.entries(cookies).map(([n, v]) => `${n}=${v}`);
    return parts.join('; ');
  }

  has(name) {
    return Boolean(this.all[name]);
  }

  clear() {
    this.store[this.key] = {};
    this.persist();
  }
}

function buildHeaders(extra = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) headers[k] = v;
  }
  return headers;
}

// Generic GET JSON with cookie + referer + optional buvid header injection.
export async function getJson(url, { referer = 'https://www.bilibili.com', jar = null, extraHeaders = {} } = {}) {
  const headers = buildHeaders();
  headers.Referer = referer;
  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v !== undefined && v !== null) headers[k] = v;
  }

  const res = await fetch(url, { headers, redirect: 'follow' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep null */ }
  return {
    status: res.status,
    headers: res.headers,
    json,
    text,
  };
}

// Generic GET returning raw bytes (for downloading media that needs Referer+cookie).
export async function getBytes(url, { referer = 'https://www.bilibili.com', jar = null, extraHeaders = {} } = {}) {
  const headers = buildHeaders();
  headers.Referer = referer;
  headers.Accept = '*/*';
  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v !== undefined && v !== null) headers[k] = v;
  }
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`下载媒体失败：HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

// GET -> raw web Response (for streaming media to a downstream consumer without buffering).
export async function streamUrl(url, { referer = 'https://www.bilibili.com', jar = null, extraHeaders = {} } = {}) {
  const headers = buildHeaders();
  headers.Referer = referer;
  headers.Accept = '*/*';
  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
  for (const [k, v] of Object.entries(extraHeaders)) {
    if (v !== undefined && v !== null) headers[k] = v;
  }
  return fetch(url, { headers, redirect: 'follow' });
}

// A bridge to persist Set-Cookie from a response into a jar.
export function adoptFromResponse(result, jar) {
  if (jar && result.headers) {
    jar.adopt(result.headers.getSetCookie
      ? result.headers.getSetCookie()
      : ((result.headers.raw) ? (result.headers.raw['set-cookie'] || []) : []));
  }
}

// Manual redirect following that captures Set-Cookie at EVERY hop (including
// intermediate hops that fetch's automatic redirect:'follow' would swallow when
// crossing domains). Used by the QR-login landing chain where SESSDATA etc. are
// set along the way. Stops after `maxHops` or when a hop is not a 3xx redirect.
// Returns { finalUrl, history: [ {url, status} ] }.
export async function followRedirectChain(startUrl, {
  referer = 'https://www.bilibili.com',
  jar = null,
  maxHops = 12,
  allowedHosts = null, // null = allow any; or callable (host)=>bool
} = {}) {
  const history = [];
  let currentUrl = startUrl;

  for (let hop = 0; hop <= maxHops; hop++) {
    const headers = buildHeaders();
    headers.Referer = referer;
    if (jar) {
      const cookieHeader = jar.toHeader();
      if (cookieHeader) headers.Cookie = cookieHeader;
    }

    const hopUrl = new URL(currentUrl, startUrl);
    if (allowedHosts && !allowedHosts(hopUrl.hostname)) {
      // stop before making an untrusted request
      return { finalUrl: currentUrl, history };
    }

    const res = await fetch(hopUrl.href, { headers, redirect: 'manual' });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    if (jar) jar.adopt(setCookies);

    const status = res.status;
    history.push({ url: hopUrl.href, status });

    const location = res.headers.get('location');
    if (status < 300 || status >= 400 || !location) {
      return { finalUrl: hopUrl.href, history };
    }
    currentUrl = new URL(location, hopUrl.href).href;
  }

  return { finalUrl: currentUrl, history };
}