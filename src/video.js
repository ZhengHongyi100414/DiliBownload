import { getJson, adoptFromResponse } from './http.js';
import { encodeWbi, extractKeyFromUrl, isValidKey, parametersToQuery } from './wbi.js';

const VIEW_URL = 'https://api.bilibili.com/x/web-interface/wbi/view';
const PAGELIST_URL = 'https://api.bilibili.com/x/player/pagelist';
const PLAY_URL = 'https://api.bilibili.com/x/player/wbi/playurl';
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';

// Bilibili quality ids (qn) -> human label for the 画质 dropdown.
// Matches DownKyi's PlaybackQualityCatalog resolutions.
const QUALITY_CATALOG = [
  { qn: 16,  label: '360P 流畅' },
  { qn: 32,  label: '480P 清晰' },
  { qn: 64,  label: '720P 高清' },
  { qn: 74,  label: '720P 60帧' },
  { qn: 80,  label: '1080P 高清' },
  { qn: 112, label: '1080P 高码率' },
  { qn: 116, label: '1080P 60帧' },
  { qn: 120, label: '4K 超清' },
  { qn: 125, label: 'HDR 真彩' },
  { qn: 126, label: '杜比视界' },
  { qn: 127, label: '超高清 8K' },
];

// 编码 dropdown (DownKyi codec ids)
const CODEC_CATALOG = [
  { codecId: 7,  label: 'H.264/AVC' },
  { codecId: 12, label: 'H.265/HEVC' },
  { codecId: 13, label: 'AV1' },
];

// 音质 dropdown (DownKyi audio qualities)
const AUDIO_CATALOG = [
  { aq: 30216, label: '低质量' },
  { aq: 30232, label: '中质量' },
  { aq: 30280, label: '高质量' },
  { aq: 30250, label: 'Dolby Atmos' },
  { aq: 30251, label: 'Hi-Res 无损' },
];

function codecName(id) {
  return CODEC_CATALOG.find((c) => c.codecId === id)?.label || `编码 ${id}`;
}
function audioName(id) {
  return AUDIO_CATALOG.find((a) => a.aq === id)?.label || (id ? `音质 ${id}` : '');
}
function qualityName(qn) {
  return QUALITY_CATALOG.find((q) => q.qn === qn)?.label || (qn ? `清晰度 ${qn}` : '');
}

class WbiKeyStore {
  constructor(jar) {
    this.jar = jar;
    this.imgKey = null;
    this.subKey = null;
  }

  async ensure() {
    if (this.imgKey && this.subKey) return;
    const res = await getJson(NAV_URL, { referer: 'https://www.bilibili.com', jar: this.jar });
    adoptFromResponse(res, this.jar);
    const wbi = res.json?.data?.wbi_img;
    if (!wbi) throw new Error('无法获取 wbi 密钥');
    const imgKey = extractKeyFromUrl(wbi.img_url);
    const subKey = extractKeyFromUrl(wbi.sub_url);
    if (!isValidKey(imgKey) || !isValidKey(subKey)) {
      throw new Error('wbi 密钥格式无效 (imgKey/subKey 需为 32 位字母数字)');
    }
    this.imgKey = imgKey;
    this.subKey = subKey;
  }

  invalidate() {
    this.imgKey = null;
    this.subKey = null;
  }
}

// Parse a Bilibili video URL / BV id / AV id into { bvid, aid }.
export function parseInput(input) {
  input = String(input || '').trim();
  if (!input) throw new Error('请输入视频链接或 BV/AV ID');

  const bvidMatch = input.match(/(BV[a-zA-Z0-9]{8,})/i);
  if (bvidMatch) return { bvid: bvidMatch[1] };

  const aidMatch = input.match(/[?&]aid=(\d+)/) || input.match(/\/av(\d+)/i);
  if (aidMatch) return { aid: aidMatch[1] };

  const soloAid = input.match(/^(av)?(\d{6,})$/i);
  if (soloAid) return { aid: soloAid[2] };

  const hostMatch = input.match(/bilibili\.com/);
  if (!hostMatch) throw new Error('无法识别的链接，请输入 B 站视频 URL 或 BV/AV ID');
  throw new Error('链接中未找到视频 ID');
}

function parseDuration(ms) {
  return formatSeconds(Math.floor(ms / 1000));
}

// Fetch ordinary video metadata.
async function fetchVideoView({ bvid = null, aid = null }, wbi) {
  const params = {};
  if (bvid) params.bvid = bvid;
  else if (aid) params.aid = aid;
  else throw new Error('缺少视频 ID');
  const signed = encodeWbi(params, wbi.imgKey, wbi.subKey, Math.floor(Date.now() / 1000));
  const query = parametersToQuery(signed);
  const url = `${VIEW_URL}?${query}`;
  const res = await getJson(url, { referer: 'https://www.bilibili.com', jar: wbi.jar });
  const data = res.json?.data;
  if (!data) {
    const msg = res.json?.message || '视频信息获取失败';
    throw new Error(msg);
  }
  return data;
}

// Fetch page (分P) list -> array of { cid, page, part, duration, dimension }.
async function fetchPagelist({ bvid = null, aid = null }, jar) {
  const params = {};
  if (bvid) params.bvid = bvid;
  else if (aid) params.aid = aid;
  const url = `${PAGELIST_URL}?${new URLSearchParams(params)}`;
  const res = await getJson(url, { referer: 'https://www.bilibili.com', jar });
  return res.json?.data ?? [];
}

// Fetch play URLs for one page (cid). Returns support formats + dash + durl.
async function fetchPlayUrl(cid, { bvid = null, aid = null }, wbi) {
  const params = {
    fourk: 1,
    fnver: 0,
    fnval: 4048,
    cid,
    qn: 127,
  };
  if (bvid) params.bvid = bvid;
  else if (aid) params.aid = aid;
  else throw new Error('缺少视频 ID');

  const signed = encodeWbi(params, wbi.imgKey, wbi.subKey, Math.floor(Date.now() / 1000));
  const query = parametersToQuery(signed);
  const url = `${PLAY_URL}?${query}`;
  const res = await getJson(url, { referer: 'https://www.bilibili.com', jar: wbi.jar });
  const data = res.json?.data;
  if (!data) {
    const msg = res.json?.message || '获取播放地址失败';
    throw new Error(msg);
  }
  return data;
}

/**
 * Resolve a single page (分P) into structured track lists so the frontend can
 * offer 画质/编码/音质 pickers and choose which artifacts to download.
 * Returns:
 * {
 *   cid, page, pageTitle, duration,
 *   video:   [ { qn, codecId, codecName, width, height, frameRate, label, url, backup[] } ],
 *   audio:   [ { aq, label, codecs, url, backup[] } ],
 *   dolby:   [ { label, url, backup[] } ],
 *   flac:    { label, url, backup[] } | null,
 *   durl:    [ { qn, label, url, size, format, duration } ],  // single-file
 *   support: [ { qn, desc } ],                                // formats directory (may require login)
 *   subtitles: [ { lan, lanDoc, url } ],
 * }
 */
async function resolvePage(cid, info, wbi, page = 1, pageDurSeconds = 0) {
  const play = await fetchPlayUrl(cid, { bvid: info.bvid, aid: info.aid }, wbi);

  const result = {
    cid,
    page,
    pageTitle: page === 1 && info.title ? info.title : `分P ${page}`,
    // pagelist pages[].duration and playurl dash.duration are in SECONDS;
    // playurl durl[].timelength is in MILLISECONDS.
    duration: formatSeconds(pageDurSeconds || play.dash?.duration || Math.floor(play.timelength / 1000) || 0),
    video: [],
    audio: [],
    dolby: [],
    flac: null,
    durl: [],
    support: [],
    subtitles: [],
  };

  const dash = play.dash;
  if (dash) {
    // ---- video tracks: every (quality × codec) combination ----
    for (const t of dash.video || []) {
      result.video.push({
        qn: t.id,
        codecId: t.codecid,
        codecName: codecName(t.codecid),
        width: t.width,
        height: t.height,
        frameRate: t.frameRate,
        label: `${qualityName(t.id)} · ${codecName(t.codecid)}`,
        url: toAbs(t.base_url),
        backup: (t.backup_url || []).map(toAbs),
        codecs: t.codecs,
      });
    }

    // ---- audio tracks: normal ----
    for (const t of dash.audio || []) {
      result.audio.push({
        aq: t.id,
        label: audioName(t.id),
        codecs: t.codecs,
        url: toAbs(t.base_url),
        backup: (t.backup_url || []).map(toAbs),
      });
    }

    // ---- dolby ----
    for (const t of dash.dolby?.audio || []) {
      result.dolby.push({
        aq: 30250,
        label: audioName(30250),
        codecs: t.codecs,
        url: toAbs(t.base_url),
        backup: (t.backup_url || []).map(toAbs),
      });
    }

    // ---- flac (single Hi-Res track) ----
    const flac = dash.flac?.audio;
    if (flac) {
      result.flac = {
        aq: 30251,
        label: audioName(30251),
        codecs: flac.codecs,
        url: toAbs(flac.base_url),
        backup: (flac.backup_url || []).map(toAbs),
      };
    }
  }

  // ---- DURL (single-file FLV/MP4, convenient for direct download) ----
  for (const seg of play.durl || []) {
    result.durl.push({
      qn: seg.quality,
      label: `${qualityName(seg.quality)} · 单文件`,
      url: seg.url,
      backup: (seg.backup_url || []).map(toAbs),
      size: seg.size,
      format: seg.format,
      duration: parseDuration(seg.timelength),
    });
  }

  // ---- support_formats directory (fallback when no stream returned) ----
  for (const f of play.support_formats || []) {
    result.support.push({ qn: f.quality, desc: f.new_description || f.codecs || '' });
  }

  return result;
}

function toAbs(url) {
  return url && !/^https?:/.test(url) ? `https:${url}` : url;
}

// Fetch subtitles for a page via PlayerV2. Returns list of { lan, lanDoc, url }.
// Don't fail the whole resolve if subtitles are unavailable.
async function fetchSubtitles(cid, { bvid = null, aid = null }, wbi) {
  const params = {};
  if (bvid) params.bvid = bvid;
  else if (aid) params.aid = aid;
  if (cid) params.cid = cid;

  const signed = encodeWbi(params, wbi.imgKey, wbi.subKey, Math.floor(Date.now() / 1000));
  const query = parametersToQuery(signed);
  const url = `https://api.bilibili.com/x/player/wbi/v2?${query}`;
  const res = await getJson(url, { referer: 'https://www.bilibili.com', jar: wbi.jar });
  const subs = res.json?.data?.subtitle?.subtitles;
  if (!subs) return [];
  return subs
    .filter((s) => s.subtitle_url)
    .map((s) => ({ lan: s.lan, lanDoc: s.lan_doc || s.lan, url: toAbs(s.subtitle_url) }));
}

/**
 * Main entry: given user input, resolve all pages and available streams.
 */
export async function resolveVideo(input, jar) {
  const { bvid, aid } = parseInput(input);
  const wbi = new WbiKeyStore(jar);
  await wbi.ensure();

  // 1) metadata
  const view = await fetchVideoView({ bvid, aid }, wbi);
  const title = view.title || '';
  const owner = view.owner?.name || '';
  const pagesCount = view.pages?.[0]?.page ?? 1;

  // 2) pagelist for cids
  let pages = await fetchPagelist({ bvid, aid }, jar);
  if (!pages || pages.length === 0) {
    pages = (view.pages || []).map((p) => ({ cid: p.cid, page: p.page, part: p.part || p.title }));
  }

  // If the video is single-page and info lacks cid, use view pages[0].cid
  if (view.pages && view.pages[0] && view.pages[0].cid) {
    // pagelist is authoritative; if empty, fall back
  }

  // 3) resolve each page's streams
  const pageResults = [];
  const pageTargets = (pages && pages.length > 0)
    ? pages
    : [{ cid: view.pages?.[0]?.cid, page: 1, part: title }];

  for (let idx = 0; idx < pageTargets.length; idx++) {
    const p = pageTargets[idx];
    if (!p.cid) continue;
    try {
      const resolved = await resolvePage(p.cid, { bvid, aid, title }, wbi, p.page || idx + 1, p.duration || 0);
      // subtitles are optional enrichment
      try {
        resolved.subtitles = await fetchSubtitles(p.cid, { bvid, aid }, wbi);
      } catch { /* subtitles optional */ }
      pageResults.push(resolved);
    } catch (e) {
      pageResults.push({
        cid: p.cid,
        page: p.page || idx + 1,
        pageTitle: p.part || `分P ${idx + 1}`,
        duration: '',
        video: [],
        audio: [],
        dolby: [],
        flac: null,
        durl: [],
        support: [],
        error: e.message,
      });
    }
  }

  return {
    bvid,
    aid,
    title,
    owner,
    cover: view.pic || '',
    views: view.stat?.view,
    // /x/web-interface/view duration is in SECONDS
    duration: formatSeconds(view.duration || 0),
    pages: pagesCount,
    pubdate: view.pubdate,
    pagesDetail: pageResults,
  };
}

// Format seconds -> "h:mm:ss" or "m:ss"
function formatSeconds(totalSec) {
  if (!totalSec || totalSec <= 0) return '--:--';
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}