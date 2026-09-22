import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import { streamUrl } from './src/http.js';
import { getSession, ensureSessionBuvid } from './src/sessions.js';
import { LoginSession } from './src/login.js';
import { resolveVideo } from './src/video.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 40031;

const app = express();
app.use(express.json());
app.use(cookieParser());

// Per-client login: every browser gets its own dili_sid cookie -> isolated
// cookie jar on the server. Two devices never share account state.

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'dilibownload' });
});

// ---- QR login (per-session) ----
app.get('/api/login/qrcode', async (req, res) => {
  try {
    const session = getSession(req, res);
    const login = new LoginSession(session.jar);
    const qr = await login.generate();
    res.json({ ok: true, ...qr });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.get('/api/login/poll', async (req, res) => {
  const key = req.query.qrcode_key;
  if (!key) return res.status(400).json({ ok: false, error: '缺少 qrcode_key' });
  try {
    const session = getSession(req, res);
    const login = new LoginSession(session.jar);
    const state = await login.poll(key);
    // verify server-side right after success; if nav disagrees, treat as not logged in
    let verified = null;
    if (state.code === 0) {
      try {
        const me = await login.verify();
        verified = me;
        if (!me.isLogin) {
          session.clearCookies(); // landing chain failed -> wipe partial state
        }
      } catch { /* network hiccup: keep cookies, let front-end verify later */ }
    }
    res.json({
      ok: true,
      code: state.code,
      state: state.code,
      message: state.message,
      hops: state.landing?.hops,
      verified: verified ? { isLogin: verified.isLogin, uname: verified.uname } : null,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Current session login state. Distinguishes:
//  - isLogin: server-side session has cookies AND /nav confirms
//  - stale:   cookies exist but /nav says not logged in (expired/revoked) -> auto-cleared
//  - error:   transient network failure (do NOT clear login state)
app.get('/api/login/status', async (req, res) => {
  const session = getSession(req, res);
  if (!session.isLoggedInRemotely()) {
    return res.json({ ok: true, isLogin: false, uname: '', state: 'anonymous' });
  }
  try {
    const login = new LoginSession(session.jar);
    const me = await login.verify();
    if (me.isLogin) {
      session.loginOk = true;
      session.loginCheckedAt = Date.now();
      return res.json({ ok: true, isLogin: true, uname: me.uname, mid: me.mid, face: me.face, vipStatus: me.vipStatus, state: 'ok' });
    }
    // cookies present but platform says anonymous -> session expired/revoked
    session.clearCookies();
    return res.json({ ok: true, isLogin: false, uname: '', state: 'expired' });
  } catch (e) {
    // transient failure: report unknown, keep cookies intact
    return res.json({ ok: true, isLogin: false, uname: '', state: 'error', error: e.message });
  }
});

app.post('/api/login/logout', (req, res) => {
  const session = getSession(req, res);
  session.clearCookies();
  res.json({ ok: true });
});

// Export cookies for external download tools (per-session).
app.get('/api/cookies', (req, res) => {
  const session = getSession(req, res);
  res.json({ ok: true, cookies: session.exportCookies() });
});

// ---- Video resolving (per-session) ----
app.post('/api/resolve', async (req, res) => {
  const input = req.body?.url || req.body?.input;
  if (!input) return res.status(400).json({ ok: false, error: '请输入视频链接' });
  try {
    const session = getSession(req, res);
    await ensureSessionBuvid(session);
    const result = await resolveVideo(input, session.jar);
    res.json({ ok: true, data: result });
  } catch (e) {
    const status = /^BV|无法识|链接中未|请输入/.test(e.message) ? 400 : 502;
    res.status(status).json({ ok: false, error: e.message });
  }
});

// Serve frontend static files.
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// ---- Stream media to the browser (for front-end ffmpeg.wasm).
// The browser can't fetch the CDN cross-origin (Referer+cookie), so we
// proxy the bytes here. Media is streamed, not stored.
app.get('/api/ffmpeg/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: '缺少 url' });
  try {
    const session = getSession(req, res);
    await ensureSessionBuvid(session);
    const upstream = await streamUrl(url, { referer: 'https://www.bilibili.com', jar: session.jar });
    if (!upstream.ok) return res.status(upstream.status).json({ ok: false, error: `上游 HTTP ${upstream.status}` });
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
    const clen = upstream.headers.get('content-length');
    res.set('Content-Type', ctype);
    if (clen) res.set('Content-Length', clen);
    res.set('Accept-Ranges', 'bytes');
    res.set('Access-Control-Allow-Origin', '*');
    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`DiliBownload listening on http://localhost:${PORT}`);
});