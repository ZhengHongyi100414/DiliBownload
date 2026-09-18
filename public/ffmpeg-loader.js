// ffmpeg-loader.js — module entry: expose the browser ffmpeg.wasm client on window.
// Loaded as <script type="module"> so it can import the self-hosted ESM bundle.
import { muxInBrowser } from './ffmpeg-client.js';

window.__diliWasm = { muxInBrowser };

// Let app.js (plain script) know wasm is available as soon as this runs.
window.dispatchEvent(new CustomEvent('dili-wasm-ready'));