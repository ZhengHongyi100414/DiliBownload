// ffmpeg-loader.js — module entry: expose the browser ffmpeg.wasm client on window.
// Loaded as <script type="module"> so it can import the self-hosted ESM bundle.
// Pre-loads ffmpeg.wasm in the background right after page load, so the first
// real download doesn't wait for a ~30MB component fetch.
import { muxInBrowser, preloadWasm, getState, onStatus } from './ffmpeg-client.js';

window.__diliWasm = { muxInBrowser, preloadWasm, getState, onStatus };

// Kick off background preload immediately.
preloadWasm().catch(() => { /* status pill shows the failure; user can retry */ });

// Let app.js (plain script) know the wasm bridge is available.
window.dispatchEvent(new CustomEvent('dili-wasm-ready'));