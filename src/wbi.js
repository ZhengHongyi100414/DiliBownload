import crypto from 'node:crypto';

// Bilibili WBI signature (port of DownKyiCore/DownKyi.Core/BiliApi/Sign/WbiSign.cs)
const MIXIN_KEY_ENCODING_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

// Reorder the real-time key using the fixed table, take first 32 chars.
function getMixinKey(origin) {
  const sb = [];
  for (const i of MIXIN_KEY_ENCODING_TABLE) {
    sb.push(origin[i]);
  }
  return sb.join('').slice(0, 32);
}

// Helper: extract key from a wbi img/sub URL. Port of WbiKeyProvider.ExtractKey.
// e.g. https://i0.hdslb.com/bfs/wbi/wbi/......png -> 32-char ascii key
export function extractKeyFromUrl(address) {
  if (!address) return '';
  const slashIdx = address.lastIndexOf('/');
  let fileName = slashIdx >= 0 ? address.slice(slashIdx + 1) : address;
  // manual scan for ? or #
  let q = -1;
  for (let i = 0; i < fileName.length; i++) {
    if (fileName[i] === '?' || fileName[i] === '#') { q = i; break; }
  }
  if (q >= 0) fileName = fileName.slice(0, q);
  const extIdx = fileName.indexOf('.');
  return extIdx < 0 ? fileName : fileName.slice(0, extIdx);
}

export function isValidKey(value) {
  return typeof value === 'string' && value.length === 32 && /^[A-Za-z0-9]{32}$/.test(value);
}

function formEncode(value) {
  return encodeURIComponent(value).replace(/%20/g, '+');
}

/**
 * Return a query string (order preserved) for a params object.
 */
export function parametersToQuery(parameters) {
  return Object.entries(parameters)
    .map(([k, v]) => `${formEncode(k)}=${formEncode(String(v))}`)
    .join('&');
}

/**
 * WBI sign. Mirrors WbiSign.EncodeWbi: adds wts, sorts by key, strips "!'()*",
 * serializes then MD5(query + mixinKey) -> w_rid.
 * Returns a plain object of all params (including wts and w_rid).
 */
export function encodeWbi(parameters, imgKey, subKey, unixTimeSeconds) {
  const params = {};
  for (const [k, v] of Object.entries(parameters)) {
    if (v !== null && v !== undefined) params[k] = String(v);
  }

  const mixinKey = getMixinKey(imgKey + subKey);
  const currTime = String(unixTimeSeconds);
  params.wts = currTime;

  // sort keys
  const sorted = Object.keys(params).sort();

  const paraStr = {};
  for (const k of sorted) {
    // strip characters ! ' ( ) *
    const cleaned = params[k].replace(/[!'()*]/g, '');
    paraStr[k] = cleaned;
  }

  const query = Object.entries(paraStr)
    .map(([k, v]) => `${formEncode(k)}=${formEncode(v)}`)
    .join('&');

  const hashBytes = crypto.createHash('md5').update(query + mixinKey).digest();
  paraStr.w_rid = Buffer.from(hashBytes).toString('hex').toLowerCase();

  return paraStr;
}