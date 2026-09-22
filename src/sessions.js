import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './http.js';
import { CookiesJar } from './http.js';
import { ensureBuvidJar } from './buvid.js';

// Per-client session registry. Each browser gets its own `dili_sid` cookie that
// maps to an isolated CookiesJar + LoginSession on the server, so two devices
// never share account state. Sessions persist in data/sessions/<sid>.json.

const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const COOKIE_NAME = 'dili_sid';
const MAX_SESSIONS = 50;          // safety cap; oldest sessions evicted
const IDLE_EXPIRE_MS = 30 * 24 * 3600 * 1000; // evict sessions idle 30 days

function ensureSessionsDir() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function newSid() {
  return crypto.randomBytes(16).toString('hex');
}

// In-memory cache: sid -> Session
const sessions = new Map();

export class ClientSession {
  constructor(sid) {
    this.sid = sid;
    this.file = path.join(SESSIONS_DIR, `${sid}.json`);
    ensureSessionsDir();
    this.jar = new CookiesJar('bilibili.com', { file: this.file });
    this.wbi = null;        // cached WBI keys (per-session)
    this.lastActive = Date.now();
    this.loginOk = null;    // cached tri-state: null=unknown, true, false
    this.loginCheckedAt = 0;
  }

  touch() {
    this.lastActive = Date.now();
  }

  isLoggedInRemotely() {
    return this.jar.has('SESSDATA');
  }

  exportCookies() {
    return this.jar.all;
  }

  clearCookies() {
    this.jar.clear();
    this.wbi = null;
    this.loginOk = null;
    this.loginCheckedAt = 0;
  }

  // Persist session state (cookie file already holds the jar; we store metadata).
  persistMeta() {
    try {
      fs.writeFileSync(this.file + '.meta', JSON.stringify({
        lastActive: this.lastActive,
      }, null, 2), 'utf8');
    } catch { /* ignore */ }
  }
}

function evictIfNeeded() {
  ensureSessionsDir();
  // periodic sweep: remove idle sessions and enforce MAX_SESSIONS
  const files = fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta')) : [];
  const now = Date.now();
  for (const f of files) {
    const p = path.join(SESSIONS_DIR, f);
    try {
      const metaPath = p + '.meta';
      let lastActive = 0;
      if (fs.existsSync(metaPath)) {
        lastActive = JSON.parse(fs.readFileSync(metaPath, 'utf8')).lastActive || 0;
      } else {
        lastActive = fs.statSync(p).mtimeMs;
      }
      if (now - lastActive > IDLE_EXPIRE_MS) {
        fs.rmSync(p, { force: true });
        fs.rmSync(metaPath, { force: true });
      }
    } catch { /* ignore per-file errors */ }
  }
  // hard cap
  const remaining = () => fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json') && !f.endsWith('.meta'));
  while (remaining().length > MAX_SESSIONS) {
    const list = remaining()
      .map((f) => ({ f, m: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m);
    const victim = list[0];
    if (!victim) break;
    fs.rmSync(path.join(SESSIONS_DIR, victim.f), { force: true });
    fs.rmSync(path.join(SESSIONS_DIR, victim.f + '.meta'), { force: true });
  }
}

// Lazily sweep on first request after startup and every ~6h.
let lastSweep = 0;
function maybeSweep() {
  const now = Date.now();
  if (now - evictIfNeeded.lastRun > 10 * 60 * 1000) {
    evictIfNeeded.lastRun = now;
    evictIfNeeded();
  }
}
evictIfNeeded.lastRun = 0;

// Resolve (or create) the ClientSession for an incoming request.
export function getSession(req, res) {
  let sid = req.cookies?.dili_sid;
  let created = false;
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) {
    sid = newSid();
    created = true;
  }

  let session = sessions.get(sid);
  if (!session) {
    session = new ClientSession(sid);
    sessions.set(sid, session);
    evictIfNeeded();
    created = true;
  }
  session.touch();

  // (re)issue cookie: 1 year, httpOnly, sameSite=lax, path=/
  res.cookie(COOKIE_NAME, sid, {
    maxAge: 365 * 24 * 3600 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  return session;
}

export function getLoadedSession(req, res) {
  const s = getSession(req, res);
  // Ensure a buvid bootstrap once per session (cheap, cached in jar).
  return s;
}

export async function ensureSessionBuvid(session) {
  // buvid is device-level: reuse a shared bootstrap across sessions is fine,
  // but apply into this session's jar so its requests look consistent.
  await ensureBuvidJar(session.jar);
  return session;
}