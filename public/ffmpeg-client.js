// ffmpeg-client.js — browser-side ffmpeg.wasm (optional, offline-friendly).
// Imports the self-hosted @ffmpeg/ffmpeg ESM bundle from /lib/esm and loads the
// self-hosted ffmpeg-core (wasm) — no public CDN dependency.
//
// Use: muxInBrowser({ videoUrl, audioUrl, title, mode, onProgress, onPhase })
//   -> fetch the two media tracks via the server's /api/ffmpeg/proxy (Referer+cookie),
//      write them into ffmpeg's in-memory FS, run ffmpeg merge/transcode,
//      read the result back and trigger a browser download.
let FFmpegLib = null;   // { FFmpeg } from @ffmpeg/ffmpeg
let ffmpegInstance = null;

// ---- preload + status tracking ----
// state: 'idle' | 'loading' | 'ready' | 'error'
let wasmState = 'idle';
let wasmError = null;
const stateListeners = new Set();
const progressListeners = new Set();

export function getState() {
  return { state: wasmState, error: wasmError };
}
export function onStatus(cb) { stateListeners.add(cb); cb(getState()); }

async function setState(s, err = null) {
  wasmState = s;
  wasmError = err || null;
  for (const cb of stateListeners) {
    try { cb(getState()); } catch { /* listener error */ }
  }
}

export async function preloadWasm() {
  if (wasmState === 'ready' || wasmState === 'loading') return;
  await setState('loading');
  try {
    const lib = await importLib();
    if (!ffmpegInstance) {
      ffmpegInstance = new lib.FFmpeg();
      ffmpegInstance.on('progress', ({ progress }) => {
        progressListeners.forEach((cb) => { try { cb(progress); } catch { /* ignore */ } });
      });
    }
    await ffmpegInstance.load({ coreURL: CORE_PATH, wasmURL: CORE_WASM });
    await setState('ready');
  } catch (e) {
    // reset so a later retry can run; remember the error for the status pill
    ffmpegInstance = null;
    await setState('error', e.message);
    throw e;
  }
}

// progress fan-out (used by muxInBrowser via onProgress)
export function onProgressEvent(cb) { progressListeners.add(cb); }

const CORE_PATH = '/lib/ffmpeg-core.esm.js';
const CORE_WASM = '/lib/ffmpeg-core.wasm';

async function importLib() {
  if (FFmpegLib) return FFmpegLib;
  const mod = await import('/lib/esm/index.js');
  FFmpegLib = mod;
  return mod;
}

// Fetch a media URL through the local proxy, returning a Uint8Array.
async function fetchMedia(url) {
  const r = await fetch(`/api/ffmpeg/proxy?url=${encodeURIComponent(url)}`);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(`媒体下载失败：${msg}`);
  }
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Run ffmpeg merge/transcode fully in the browser.
 * @returns {Promise<void>} downloads the result mp4 when done.
 */
export async function muxInBrowser({ videoUrl, audioUrl = null, title = 'video', mode = 'copy', onProgress, onPhase } = {}) {
  // Ensure the wasm core is loaded (preloaded in background; this awaits if still
  // loading, or retries after a failure).
  if (wasmState !== 'ready') {
    if (onPhase) onPhase('加载下载组件…');
    await preloadWasm();
  }
  if (!ffmpegInstance) throw new Error('下载组件未就绪');

  if (onPhase) onPhase('正在获取视频…');
  const videoData = await fetchMedia(videoUrl);
  await ffmpegInstance.writeFile('video.m4s', videoData);
  let hasAudio = false;
  if (audioUrl) {
    if (onPhase) onPhase('正在获取音频…');
    const audioData = await fetchMedia(audioUrl);
    await ffmpegInstance.writeFile('audio.m4s', audioData);
    hasAudio = true;
  }

  const safeTitle = String(title || 'video').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  const outName = `${safeTitle}.${mode}.mp4`;

  if (onPhase) onPhase(mode === 'copy' ? '正在生成 MP4 文件…' : '正在生成兼容格式的 MP4（较慢，请耐心等待）…');
  const args = ['-hide_banner', '-y', '-i', 'video.m4s'];
  if (hasAudio) args.push('-i', 'audio.m4s');
  if (mode === 'copy') {
    args.push('-c', 'copy', '-movflags', '+faststart');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23');
    if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
    args.push('-movflags', '+faststart');
  }
  args.push(outName);

  const rc = await ffmpegInstance.exec(args);
  if (rc !== 0) throw new Error(`ffmpeg 执行失败 (code ${rc})`);

  if (onPhase) onPhase('马上完成…');
  const data = await ffmpegInstance.readFile(outName);
  const blob = new Blob([data.buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);

  // cleanup fs
  try { await ffmpegInstance.deleteFile('video.m4s'); } catch { /* ignore */ }
  try { if (hasAudio) await ffmpegInstance.deleteFile('audio.m4s'); } catch { /* ignore */ }
  try { await ffmpegInstance.deleteFile(outName); } catch { /* ignore */ }

  if (onProgress) onProgress(1);
  if (onPhase) onPhase('完成');
  return outName;
}

// Make EOF helpers visible for non-module script usage if needed.
export { CORE_PATH };