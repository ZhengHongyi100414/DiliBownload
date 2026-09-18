import QRCode from 'qrcode';
import { getJson, adoptFromResponse, followRedirectChain, CookiesJar } from './http.js';

const GENERATE_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL_URL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';

// Render a QR SVG data URL locally (no public CDN dependency).
async function svgQrDataUrl(text) {
  const svg = await QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

// QR login states returned by poll
export const QR_STATES = {
  UNUSED: 86101,   // waiting to be scanned
  SCANNED: 86090,  // scanned, awaiting confirm
  EXPIRED: 86038,  // expired
  SUCCESS: 0,      // confirmed -> cookies set
};

export class LoginSession {
  constructor(jar = null) {
    this.jar = jar || new CookiesJar();
  }

  // Step 1: request a QR code + its key. Returns { url, qrcode_key, qr_image }.
  async generate() {
    const res = await getJson(GENERATE_URL, {
      referer: 'https://www.bilibili.com',
      jar: null, // QR flow starts anonymous
    });
    adoptFromResponse(res, this.jar);
    const data = res.json?.data;
    if (!data || !data.qrcode_key) {
      throw new Error('无法获取二维码：B站接口未返回 qrcode_key');
    }
    // Render the QR locally as an SVG data URL (no dependency on any public CDN).
    const qrImage = await svgQrDataUrl(data.url);
    return { url: data.url, qrcode_key: data.qrcode_key, qr_image: qrImage };
  }

  // Step 2: poll login status. When SUCCESS, the response Set-Cookie carries the session
  // AND data.url is a cross-domain landing chain that sets the remaining session
  // cookies (e.g. SESSDATA). We follow it manually to capture every hop.
  async poll(qrcodeKey) {
    const url = `${POLL_URL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`;
    const res = await getJson(url, {
      referer: 'https://www.bilibili.com',
      jar: this.jar,
    });
    adoptFromResponse(res, this.jar);

    const code = res.json?.data?.code ?? res.json?.code ?? -1;
    const message = res.json?.message || res.json?.data?.message || '';
    const dataUrl = res.json?.data?.url;

    let cookies = null;
    let landing = { hops: 0 };
    if (code === QR_STATES.SUCCESS) {
      if (dataUrl) {
        // Follow the cross-domain landing chain on bilibili hosts only.
        try {
          landing = await followRedirectChain(dataUrl, {
            referer: 'https://www.bilibili.com',
            jar: this.jar,
            allowedHosts: (h) => h === 'bilibili.com' || h.endsWith('.bilibili.com'),
          });
        } catch (e) {
          // even if landing fails, keep whatever cookies poll already got
        }
      }
      cookies = this.jar.all;
    }

    return { code, message, url: dataUrl, cookies, landing: { hops: landing.history.length } };
  }

  // After SUCCESS, call /nav to double-check isLogin and grab account info + username.
  async verify() {
    const res = await getJson('https://api.bilibili.com/x/web-interface/nav', {
      referer: 'https://www.bilibili.com',
      jar: this.jar,
    });
    const data = res.json?.data;
    return {
      isLogin: Boolean(data?.isLogin),
      mid: data?.mid ?? -1,
      uname: data?.uname ?? '',
      face: data?.face ?? '',
      vipStatus: data?.vipStatus ?? 0,
    };
  }

  isLoggedIn() {
    return this.jar.has('SESSDATA') && this.jar.has('buvid3');
  }

  exportCookies() {
    return this.jar.all;
  }

  logout() {
    this.jar.clear();
  }
}