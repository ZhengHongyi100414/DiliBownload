import express from 'express';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { CookiesJar, streamUrl } from './src/http.js';
import { ensureBuvidJar } from './src/buvid.js';
import { LoginSession } from './src/login.js';
import { resolveVideo } from './src/video.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 40031;

const app = express();
app.use(express.json());

// Shared singleton jars. In a multi-user deployment each user would get their own;
// for a personal/local app a single global session is fine.
const jar = new CookiesJar('bilibili.com');
const login = new LoginSession(jar);

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'dilibownload' });
});

// ---- QR login ----
app.get('/api/login/qrcode', async (req, res) => {
  try {
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
    const state = await login.poll(key);
    res.json({ ok: true, code: state.code, state: state.code, message: state.message, hops: state.landing?.hops });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// After QR success front-end calls this to confirm & grab profile
app.get('/api/login/status', async (req, res) => {
  try {
    const me = await login.verify();
    res.json({ ok: true, ...me });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

app.post('/api/login/logout', (req, res) => {
  login.logout();
  res.json({ ok: true });
});

// Export cookies (e.g. for aria2 / IDM).
app.get('/api/cookies', (req, res) => {
  res.json({ ok: true, cookies: jar.all });
});

// ---- Video resolving ----
app.post('/api/resolve', async (req, res) => {
  const input = req.body?.url || req.body?.input;
  if (!input) return res.status(400).json({ ok: false, error: '请输入视频链接' });
  try {
    await ensureBuvidJar(jar);
    const result = await resolveVideo(input, jar);
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
// query: ?url=<encoded m4s url>
app.get('/api/ffmpeg/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ ok: false, error: '缺少 url' });
  try {
    await ensureBuvidJar(jar);
    const upstream = await streamUrl(url, { referer: 'https://www.bilibili.com', jar });
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