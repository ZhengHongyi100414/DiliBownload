// DiliBownload frontend controller
(async () => {
  const $ = (id) => document.getElementById(id);
  const resultBox = $('result');
  const toastEl = $('toast');

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  async function api(path, opts = {}) {
    const resp = await fetch(path, opts);
    let json = null;
    try { json = await resp.json(); } catch { /* ignore */ }
    if (!json || !json.ok) {
      const err = json?.error || `HTTP ${resp.status}`;
      throw new Error(err);
    }
    return json;
  }

  // ---- Login state ----
  let loginState = { isLogin: false };
  async function refreshLoginState() {
    try {
      const s = await api('/api/login/status');
      loginState = s;
      const pill = $('login-pill');
      const logoutBtn = $('logout-btn');
      const loginBtn = $('login-btn');
      if (s.isLogin) {
        pill.textContent = `已登录 · ${s.uname || s.mid}`;
        pill.className = 'pill on';
        logoutBtn.style.display = '';
        loginBtn.style.display = 'none';
      } else if (s.state === 'expired') {
        pill.textContent = '登录已失效，请重新扫码';
        pill.className = 'pill off';
        logoutBtn.style.display = 'none';
        loginBtn.style.display = '';
      } else if (s.state === 'error') {
        pill.textContent = '登录状态未知（网络异常）';
        pill.className = 'pill off';
        logoutBtn.style.display = 'none';
        loginBtn.style.display = 'none'; // keep current cookies; retry shortly
        setTimeout(refreshLoginState, 8000);
      } else {
        pill.textContent = '未登录';
        pill.className = 'pill off';
        logoutBtn.style.display = 'none';
        loginBtn.style.display = '';
      }
    } catch {
      /* server down: keep pill as is */
    }
  }

  // ---- QR login flow ----
  let pollTimer = null;
  async function startQrLogin() {
    const modal = $('qr-modal');
    const host = $('qr-host');
    const status = $('qr-status');
    const errEl = $('qr-error');
    errEl.style.display = 'none';
    modal.classList.add('show');
    host.innerHTML = '<span class="muted">加载中…</span>';
    status.textContent = '请用对应 App 扫码';
    clearInterval(pollTimer);

    let qrcodeKey = null;
        try {
          const qr = await api('/api/login/qrcode');
          qrcodeKey = qr.qrcode_key;
          // Render the QR from the server-provided data URL (SVG). No external CDN needed.
          host.innerHTML = '';
          const img = document.createElement('img');
          img.alt = '登录二维码';
          if (qr.qr_image) {
            img.src = qr.qr_image;
          } else {
            img.src = qr.url; // fallback: some setups can show the URL as an image
          }
          host.appendChild(img);
        } catch (e) {
      host.innerHTML = '<span class="muted">二维码加载失败</span>';
      errEl.textContent = e.message;
      errEl.style.display = '';
    }

    // Poll every 2s
    pollTimer = setInterval(async () => {
      if (!qrcodeKey) return;
      try {
        const s = await api(`/api/login/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`);
        if (s.code === 86101) status.textContent = '请用对应 App 扫码';
        else if (s.code === 86090) status.textContent = '已在手机确认？等待…';
        else if (s.code === 86038) {
          // expired -> auto-refresh a fresh QR so the user doesn't have to close/reopen
          clearInterval(pollTimer);
          status.textContent = '二维码已过期，正在刷新…';
          setTimeout(() => startQrLogin(), 800);
        }
        else if (s.code === 0) {
          clearInterval(pollTimer);
          if (s.verified && s.verified.isLogin === false) {
            // server-side verify failed: landing chain didn't complete
            status.textContent = '登录未完成，正在重试…';
            setTimeout(() => startQrLogin(), 800);
          } else {
            status.textContent = '✅ 登录成功';
            setTimeout(() => {
              modal.classList.remove('show');
              refreshLoginState();
              toast('登录成功');
            }, 700);
          }
        }
      } catch (e) { /* poll transient */ }
    }, 2000);
  }

  $('login-btn').addEventListener('click', startQrLogin);
  $('qr-close').addEventListener('click', () => {
    $('qr-modal').classList.remove('show');
    clearInterval(pollTimer);
  });
  $('logout-btn').addEventListener('click', async () => {
    try { await api('/api/login/logout', { method: 'POST' }); } catch {}
    refreshLoginState();
    toast('已退出登录');
  });

  // ---- Resolve video ----
  $('resolve-btn').addEventListener('click', resolve);
  $('url-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') resolve(); });

  async function resolve() {
    const input = $('url-input').value.trim();
    if (!input) { toast('请输入链接'); return; }

    const btn = $('resolve-btn');
    const old = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 解析中';
    resultBox.innerHTML = '';

    try {
      const r = await api('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: input }),
      });
      render(r.data);
    } catch (e) {
      resultBox.innerHTML = `<div class="card error">解析失败：${escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  function render(data) {
    const parts = [];
    parts.push(`<div class="card video-meta">`);
    if (data.cover) parts.push(`<img src="${escapeHtml(data.cover)}" style="width:160px;border-radius:8px;float:right;margin:0 0 8px 16px">`);
    parts.push(`<strong>${escapeHtml(data.title || '(无标题)')}</strong>`);
    const meta = [];
    if (data.owner) meta.push(`UP：${escapeHtml(data.owner)}`);
    if (data.duration) meta.push(`时长 ${data.duration}`);
    if (data.pages) meta.push(`${data.pages} 分P`);
    if (data.views) meta.push(`播放 ${data.views.toLocaleString()}`);
    if (meta.length) parts.push(`<div class="line">${meta.join(' · ')}</div>`);
    parts.push(`<div class="line muted">${escapeHtml(data.bvid ? 'BV ' + data.bvid : '')}${data.aid ? '· AV ' + data.aid : ''}</div>`);
    parts.push(`</div>`);

    for (const [idx, page] of data.pagesDetail.entries()) {
      parts.push(`<div class="page-box" data-page="${escapeAttr(JSON.stringify(page))}" data-cover="${escapeAttr(data.cover || '')}">`);
      parts.push(`<div class="page-head"><span>${escapeHtml(page.pageTitle)}</span><span class="badge">P${page.page}</span><span class="muted" style="font-size:12px">${escapeHtml(page.duration)}</span></div>`);
      if (page.error) {
        parts.push(`<div class="error muted">该分P解析失败：${escapeHtml(page.error)}</div>`);
      } else if (isEmptyPage(page)) {
        parts.push(`<div class="empty-note">该分P没有可解析的媒体${loginState.isLogin ? '' : '。若视频需要登录观看，请先扫码登录。'}${page.support.length ? '（可支持格式：' + page.support.map(s => escapeHtml(s.desc || s.qn)).join('、') + '）' : ''}</div>`);
      } else {
        parts.push(buildPicker(page, data, idx));
      }
      parts.push(`</div>`);
    }

    resultBox.innerHTML = parts.join('');
    // initialize codec dropdowns for each picker
    document.querySelectorAll('.page-box select[data-pick-kind="quality"]').forEach((sel) => {
      repopulateCodec(sel.getAttribute('data-pick'));
    });
  }

  function isEmptyPage(page) {
    return (page.video?.length || 0) === 0
      && (page.durl?.length || 0) === 0
      && (page.audio?.length || 0) === 0;
  }

  // ---- DownKyi-style picker: 画质 / 编码 / 音质 + 下载项 checkbox ----
  function buildPicker(page, data, idx) {
    const uid = `p${idx}`;
    // 画质 options: quality entries from dash video (dedup by qn, highest codec first)
    const video = page.video || [];
    const durl = page.durl || [];

    const qualityOpts = [];
    const seenQn = new Set();
    // dash first (preferred), sorted desc by qn
    video.sort((a, b) => (b.qn || 0) - (a.qn || 0));
    for (const t of video) {
      if (seenQn.has(t.qn)) continue;
      seenQn.add(t.qn);
      qualityOpts.push({ value: `v-${t.qn}`, text: qualityLabel(t), qn: t.qn, kind: 'dash' });
    }
    for (const d of durl) {
      qualityOpts.push({ value: `d-${d.qn}`, text: `${qualityName(d.qn)} · 单文件`, qn: d.qn, kind: 'durl', size: d.size });
    }

    const audioOpts = [];
    for (const a of page.audio || []) { audioOpts.push({ value: `a-${a.aq}`, text: a.label || `音质 ${a.aq}`, url: a.url, aq: a.aq }); }
    for (const d of page.dolby || []) { audioOpts.push({ value: `dolby`, text: 'Dolby Atmos', url: d.url, aq: 30250 }); }
    if (page.flac) audioOpts.push({ value: 'flac', text: 'Hi-Res 无损 (FLAC)', url: page.flac.url, aq: 30251 });
    // 高质量 (30280) 排最前作为默认选中项
    audioOpts.sort((a, b) => (b.aq === 30280 ? 1 : 0) - (a.aq === 30280 ? 1 : 0) || b.aq - a.aq);

    const hasDash = video.length > 0;
    const hasDurl = durl.length > 0;

    const s = [];
    s.push(`<div class="picker-row">`);
    s.push(`<div class="picker-group"><label>画质</label><select data-pick="${uid}" data-pick-kind="quality" id="${uid}-quality">`);
    s.push(...qualityOpts.map(o => `<option value="${o.value}">${escapeHtml(o.text)}</option>`));
    s.push(`</select></div>`);

    s.push(`<div class="picker-group"><label>编码</label><select data-pick="${uid}" data-pick-kind="codec" id="${uid}-codec">`);
    s.push(`</select></div>`);

    s.push(`<div class="picker-group"><label>音质</label><select data-pick="${uid}" data-pick-kind="audio" id="${uid}-audio">`);
    if (audioOpts.length) s.push(...audioOpts.map(o => `<option value="${o.value}">${escapeHtml(o.text)}</option>`));
    else s.push(`<option value="">跟随视频 (单文件)</option>`);
    s.push(`</select></div>`);
    s.push(`</div>`);

    // 下载项 checkbox
    s.push(`<div class="dl-options" role="group" aria-label="下载内容"><span class="t">下载内容：</span>`);
    s.push(`<label class="checkbox-pill"><input type="checkbox" data-kind="video" data-pick="${uid}" checked> 视频</label>`);
    s.push(`<label class="checkbox-pill"><input type="checkbox" data-kind="audio" data-pick="${uid}" checked> 音频</label>`);
    const subCount = (page.subtitles || []).length;
    s.push(`<label class="checkbox-pill"><input type="checkbox" data-kind="subtitle" data-pick="${uid}"> 字幕${subCount ? `(${subCount})` : ''}</label>`);
    if (data.cover) s.push(`<label class="checkbox-pill"><input type="checkbox" data-kind="cover" data-pick="${uid}"> 封面</label>`);
    s.push(`</div>`);

    s.push(`<button class="gen-btn" data-pick="${uid}">生成下载链接</button>`);
    s.push(`<div class="gen-result" id="${uid}-result"></div>`);
    if (!hasDash && !hasDurl) s.push(`<div class="empty-note">无可用清晰度。${loginState.isLogin ? '疑似登录失效或接口风控，可尝试退出后重新登录。' : '登录后可解锁更高清晰度。'}</div>`);

    // data attributes for JS (page data lives on the .page-box wrapper)
    return s.join('');
  }

  function qualityLabel(t) {
    return `${qualityName(t.qn)} · ${t.codecName}`;
  }

  function qualityName(qn) {
    const map = {
      16: '360P 流畅', 32: '480P 清晰', 64: '720P 高清', 74: '720P 60帧',
      80: '1080P 高清', 112: '1080P 高码率', 116: '1080P 60帧', 120: '4K 超清',
      125: 'HDR 真彩', 126: '杜比视界', 127: '超高清 8K',
    };
    return map[qn] || `清晰度 ${qn}`;
  }

  // returns list of codec options for a chosen dash quality
  function codecsFor(page, qn) {
    const list = (page.video || []).filter(t => t.qn === qn);
    const seen = new Set();
    const out = [];
    for (const t of list) {
      if (seen.has(t.codecId)) continue;
      seen.add(t.codecId);
      out.push({ codecId: t.codecId, codecName: t.codecName, track: t });
    }
    return out;
  }

  // copy & download (client-side only)
  document.addEventListener('click', (e) => {
    const copyBtn = e.target.closest && e.target.closest('[data-copy]');
    if (copyBtn) {
      const val = copyBtn.getAttribute('data-copy');
      if (val) { copyText(val); toast('已复制链接'); }
      return;
    }
    const dlBtn = e.target.closest && e.target.closest('[data-dl]');
    if (dlBtn) {
      const href = dlBtn.getAttribute('data-dl');
      if (href) { window.open(href, '_blank'); }
      return;
    }
    const genBtn = e.target.closest && e.target.closest('.gen-btn');
    if (genBtn) {
      generate(genBtn.getAttribute('data-pick'));
      return;
    }
    const wasmBtn = e.target.closest && e.target.closest('[data-wasmmux]');
    if (wasmBtn) {
      runWasmMux(wasmBtn.getAttribute('data-wasmmux'), wasmBtn.getAttribute('data-mode'));
    }
  });

  // 画质改变 -> 重填编码下拉
  document.addEventListener('change', (e) => {
    const sel = e.target;
    if (sel.matches?.('select[data-pick-kind="quality"]')) {
      repopulateCodec(sel.getAttribute('data-pick'));
    }
  });

  function pageFor(uid) {
    const host = document.getElementById(`${uid}-quality`);
    if (!host) return null;
    let node = host;
    while (node && node !== document.body && node.getAttribute?.('data-page') == null) node = node.parentNode;
    const pageAttr = node?.getAttribute?.('data-page');
    const coverAttr = node?.getAttribute?.('data-cover') || '';
    if (!pageAttr) return null;
    try {
      const page = JSON.parse(pageAttr);
      return { page, cover: coverAttr };
    } catch { return null; }
  }

  function repopulateCodec(uid) {
    const qSel = document.getElementById(`${uid}-quality`);
    const cSel = document.getElementById(`${uid}-codec`);
    if (!qSel || !cSel) return;
    const ctx = pageFor(uid);
    if (!ctx) return;
    const page = ctx.page;
    const val = qSel.value;
    if (!val.startsWith('v-')) {
      // durl chosen: codec dropdown disabled
      cSel.innerHTML = `<option value="">-</option>`;
      cSel.disabled = true;
      return;
    }
    const qn = Number(val.slice(2));
    const codecs = codecsFor(page, qn);
    if (!codecs.length) { cSel.innerHTML = `<option value="">-</option>`; cSel.disabled = true; return; }
    cSel.disabled = false;
    const opts = codecs.map((c) => `<option value="${c.codecId}">${escapeHtml(c.codecName)}</option>`);
    cSel.innerHTML = opts.join('');
  }

  function generate(uid) {
    const qSel = document.getElementById(`${uid}-quality`);
    const cSel = document.getElementById(`${uid}-codec`);
    const aSel = document.getElementById(`${uid}-audio`);
    const resultBox = document.getElementById(`${uid}-result`);
    const ctx = pageFor(uid);
    if (!qSel || !resultBox) return;
    if (!ctx) { resultBox.innerHTML = '<div class="error">内部错误：未找到分P数据</div>'; return; }
    const page = ctx.page;
    const cover = ctx.cover;

    const items = []; // { tag, url }
    const wanted = { video: false, audio: false, subtitle: false, cover: false };
    document.querySelectorAll(`input[data-pick="${uid}"]`).forEach((cb) => {
      if (cb.checked) wanted[cb.getAttribute('data-kind')] = true;
    });

    // Selected media for local muxing
    let selVideo = null; // { url, codecName, qn }
    let selAudio = null; // { url, text }

    const qVal = qSel.value;
    let audioOpt = aSel ? aSel.value : '';

    if (qVal.startsWith('d-')) {
      // single-file DURL: video + audio bundled — mux can just remux the one file
      const d = (page.durl || []).find((dd) => String(dd.qn) === qVal.slice(2));
      if (d) {
        if (wanted.video) items.push({ tag: '视频+音频 (单文件)', url: d.url, backup: d.backup });
        selVideo = { url: d.url, codecName: 'DURL', qn: d.qn }; selAudio = null;
      }
    } else if (qVal.startsWith('v-')) {
      const qn = Number(qVal.slice(2));
      const codecs = codecsFor(page, qn);
      const codecId = cSel && cSel.value ? Number(cSel.value) : (codecs[0]?.codecId || null);
      let track = codecs.find((c) => c.codecId === codecId)?.track || codecs[0]?.track;
      if (wanted.video && track) {
        items.push({ tag: `视频 ${qualityName(qn)} · ${track.codecName}`, url: track.url, backup: track.backup });
      }
      if (track) selVideo = { url: track.url, codecName: track.codecName, qn };
      if (wanted.audio) {
        const audioTrack = findAudio(page, audioOpt);
        if (audioTrack) { items.push({ tag: `音频 ${audioTrack.text}`, url: audioTrack.url, backup: audioTrack.backup }); selAudio = audioTrack; }
      }
    }

    if (wanted.subtitle) {
      for (const sub of page.subtitles || []) {
        items.push({ tag: `字幕 ${sub.lanDoc || sub.lan}`, url: sub.url });
      }
    }
    if (wanted.cover && cover) {
      items.push({ tag: '封面', url: cover });
    }

    if (!items.length) {
      resultBox.innerHTML = '<div class="error">没有选择需要下载的内容，或当前画质/编码组合无对应轨道。</div>';
      return;
    }

    const html = items.map((it) => {
      const b = it.backup?.length ? `<span class="login-hint">备用地址 ${it.backup.length} 条</span>` : '';
      return `<div class="url-item"><span class="tag">${escapeHtml(it.tag)}</span><span class="u">${escapeHtml(it.url)}</span><span class="copy-here" data-copy="${escapeAttr(it.url)}">复制</span><a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">打开</a>${b}</div>`;
    }).join('');

    // browser ffmpeg.wasm mux bar (only when a video track is selected)
    let muxBar = '';
    if (selVideo && typeof window.__diliWasm !== 'undefined' && window.__diliWasm) {
      muxBar = `<div class="mux-bar">
        <span class="t">已选好画质和音质，直接下载成 MP4：</span>
        <button class="mux-btn" data-wasmmux="${uid}" data-mode="copy" title="速度快的下载方式，MP4 文件已经过优化，但对少数播放器兼容性稍差">开始下载（快速）</button>
        <button class="mux-btn" data-wasmmux="${uid}" data-mode="transcode" title="较慢的下载方式，MP4 文件在任何设备和播放器上都能播放">开始下载（兼容）</button>
        <span class="mux-status" data-wasmstatus="${uid}"></span>
        <div class="mux-progress" data-wasmbar="${uid}"><i></i></div>
      </div>`;
    }
    resultBox.innerHTML = muxBar + html;
  }

  // ---- shared: resolve selected video/audio URLs ----
  function getSelectedUrls(page, uid) {
    const qSel = document.getElementById(`${uid}-quality`);
    const cSel = document.getElementById(`${uid}-codec`);
    const aSel = document.getElementById(`${uid}-audio`);
    const qVal = qSel ? qSel.value : '';
    let videoUrl = null, audioUrl = null;
    if (qVal.startsWith('d-')) {
      const d = (page.durl || []).find((dd) => String(dd.qn) === qVal.slice(2));
      if (d) videoUrl = d.url;
    } else if (qVal.startsWith('v-')) {
      const qn = Number(qVal.slice(2));
      const codecs = codecsFor(page, qn);
      const codecId = cSel && cSel.value ? Number(cSel.value) : codecs[0]?.codecId;
      const track = codecs.find((c) => c.codecId === codecId)?.track || codecs[0]?.track;
      if (track) videoUrl = track.url;
      const audioTrack = findAudio(page, (aSel && aSel.value) || '');
      if (audioTrack) audioUrl = audioTrack.url;
    }
    return { videoUrl, audioUrl };
  }

  // ---- browser ffmpeg.wasm mux ----
  async function runWasmMux(uid, mode) {
    const ctx = pageFor(uid);
    if (!ctx) { toast('内部错误'); return; }
    const page = ctx.page;
    const statusEl = document.querySelector(`[data-wasmstatus="${uid}"]`);
    const bar = document.querySelector(`[data-wasmbar="${uid}"] i`);
    const { videoUrl, audioUrl } = getSelectedUrls(page, uid);
    if (!videoUrl) { toast('请先选择画质'); return; }

    if (bar) bar.style.width = '0%';
    [...document.querySelectorAll(`[data-wasmmux="${uid}"]`)].forEach((b) => b.disabled = true);
    statusEl.textContent = '准备下载组件…（首次需加载约 30MB）';

    try {
      await window.__diliWasm.muxInBrowser({
        videoUrl, audioUrl: audioUrl || null,
        title: page.pageTitle || 'video',
        mode,
        onProgress: (p) => { if (bar) bar.style.width = Math.round((p || 0) * 100) + '%'; },
        onPhase: (msg) => { if (statusEl) statusEl.textContent = msg; },
      });
      if (statusEl) statusEl.textContent = '完成：已触发下载。若未下载请检查弹窗拦截。';
      if (bar) bar.style.width = '100%';
    } catch (e) {
      if (statusEl) statusEl.textContent = '失败：' + e.message;
    } finally {
      [...document.querySelectorAll(`[data-wasmmux="${uid}"]`)].forEach((b) => b.disabled = false);
    }
  }

  function findAudio(page, audioOpt) {
    if (audioOpt === 'dolby') { const d = page.dolby?.[0]; return d ? { text: 'Dolby Atmos', url: d.url, backup: d.backup } : null; }
    if (audioOpt === 'flac') { const f = page.flac; return f ? { text: 'Hi-Res 无损 (FLAC)', url: f.url, backup: f.backup } : null; }
    if (audioOpt.startsWith('a-')) {
      const aq = audioOpt.slice(2);
      const a = (page.audio || []).find((x) => String(x.aq) === aq);
      return a ? { text: a.label || `音质 ${aq}`, url: a.url, backup: a.backup } : null;
    }
    // default: highest normal audio
    const a = (page.audio || [])[0];
    return a ? { text: a.label || '', url: a.url, backup: a.backup } : null;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand && document.execCommand('copy');
    document.body.removeChild(ta);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // ---- wasm status pill (bottom-right) ----
  const pill = $('wasm-pill');
  const pillTextEl = pill ? pill.querySelector('#wasm-pill-text') : null;
  const PILL_TEXT = {
    idle: '组件待加载',
    loading: '组件加载中…',
    ready: '组件已就绪',
    error: '组件加载失败，点击重试',
  };

  function watchWasm(attempt = 0) {
    if (attempt > 50) return; // give up after ~15s (loader absent, e.g. tests)
    if (typeof window.__diliWasm === 'undefined' || !window.__diliWasm.getState) {
      setTimeout(() => watchWasm(attempt + 1), 300);
      return;
    }
    window.__diliWasm.onStatus(({ state, error }) => {
      pill.className = `wasm-pill ${state}`;
      if (pillTextEl) pillTextEl.textContent = PILL_TEXT[state] || state;
      pill.title = state === 'error' ? `加载失败：${error || '未知原因'}。点击重试` : '下载组件状态（点击重试）';
    });
    pill.addEventListener('click', () => {
      if (window.__diliWasm.getState().state === 'error') {
        window.__diliWasm.preloadWasm().catch(() => {});
      }
    });
  }
  watchWasm();

  await refreshLoginState();
})();