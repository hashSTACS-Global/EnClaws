'use strict';
/**
 * competitor-scan: 扫垂类竞品账号近 N 天高赞内容
 *
 * 实现情况（2026-04-23，reality check）：
 *   - bilibili → 真实（需要 WBI 签名，公开可行；详见 fetchBilibiliUser）
 *   - weibo    → 需要 cookie（env var WEIBO_COOKIE）；否则返回清晰错误
 *   - zhihu    → 需要 cookie（env var ZHIHU_COOKIE）；否则返回清晰错误
 *
 * 这三个平台对"用户主页近期内容"比热榜防爬严格得多：
 *   - weibo m.weibo.cn 无 cookie 时 432 blocked
 *   - zhihu user/answers 无 cookie 时 401 要求 app-auth
 *   - bilibili space/arc/search 自 2023 起要求 WBI 签名（已实装）
 *
 * 调用格式：
 *   node scan.js --account-list "bilibili:208259,weibo:5720474518,zhihu:zhang-jia-wei" \
 *                --days 7 --min-likes 500 --max-per-account 10
 *
 * 对 weibo/zhihu 要求：分别设置 env var WEIBO_COOKIE / ZHIHU_COOKIE。
 */

const https = require('node:https');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = { accountList: null, days: 7, minLikes: 500, maxPerAccount: 10 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--account-list':     r.accountList    = argv[++i]; break;
      case '--days':             r.days           = parseInt(argv[++i], 10) || 7; break;
      case '--min-likes':        r.minLikes       = parseInt(argv[++i], 10) || 500; break;
      case '--max-per-account':  r.maxPerAccount  = parseInt(argv[++i], 10) || 10; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

function parseAccountList(s) {
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean).map((raw) => {
    const idx = raw.indexOf(':');
    if (idx < 0) return { raw, platform: null, handle: raw };
    return {
      raw,
      platform: raw.slice(0, idx),
      handle: raw.slice(idx + 1),
    };
  });
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function fetchRaw(url, headers = {}, redirectsLeft = 3, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error(`bad url: ${url}`)); }
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: {
          'User-Agent': DEFAULT_UA,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, url).href;
          res.resume();
          return resolve(fetchRaw(next, headers, redirectsLeft - 1, timeoutMs));
        }
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchJson(url, headers = {}) {
  const r = await fetchRaw(url, headers);
  if (r.status < 200 || r.status >= 300) {
    const msg = r.body.slice(0, 150);
    const err = new Error(`http ${r.status}: ${msg}`);
    err.status = r.status;
    throw err;
  }
  try {
    return JSON.parse(r.body);
  } catch (e) {
    throw new Error(`invalid json: ${r.body.slice(0, 150)}`);
  }
}

// ---------------------------------------------------------------------------
// Bilibili WBI signature
// Reference: https://socialsisteryi.github.io/bilibili-API-collect/docs/misc/sign/wbi.html
// ---------------------------------------------------------------------------

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

let cachedWbiKeys = null;
let cachedWbiAt = 0;
let cachedBuvid3 = null;
let cachedBuvid3At = 0;

/**
 * Acquire a buvid3 device cookie from bilibili spi endpoint.
 * Without it, space/arc/search returns code=-352 风控校验失败 even with proper WBI sig.
 */
async function getBilibiliBuvid3() {
  const age = Date.now() - cachedBuvid3At;
  if (cachedBuvid3 && age < 6 * 60 * 60 * 1000) {
    return cachedBuvid3;
  }
  // 1) Try the spi endpoint which directly returns buvid3/buvid4 in response body
  try {
    const body = await fetchJson('https://api.bilibili.com/x/frontend/finger/spi', {
      Referer: 'https://www.bilibili.com/',
    });
    const b3 = body?.data?.b_3 || body?.data?.buvid3;
    const b4 = body?.data?.b_4 || body?.data?.buvid4;
    if (b3) {
      cachedBuvid3 = `buvid3=${b3}; buvid4=${b4 || ''};`;
      cachedBuvid3At = Date.now();
      return cachedBuvid3;
    }
  } catch (_) {
    // fall through
  }
  // 2) Fallback: hit bilibili.com and parse Set-Cookie for buvid3
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'www.bilibili.com',
        path: '/',
        method: 'GET',
        headers: { 'User-Agent': DEFAULT_UA },
      },
      (res) => {
        const setCookies = res.headers['set-cookie'] || [];
        let buvid3 = '';
        for (const c of setCookies) {
          const m = /buvid3=([^;]+)/.exec(c);
          if (m) buvid3 = m[1];
        }
        res.resume();
        if (!buvid3) {
          return reject(new Error('could not acquire buvid3 cookie'));
        }
        cachedBuvid3 = `buvid3=${buvid3};`;
        cachedBuvid3At = Date.now();
        resolve(cachedBuvid3);
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function getWbiKeys() {
  const age = Date.now() - cachedWbiAt;
  if (cachedWbiKeys && age < 6 * 60 * 60 * 1000) {
    return cachedWbiKeys;
  }
  const body = await fetchJson('https://api.bilibili.com/x/web-interface/nav', {
    Referer: 'https://www.bilibili.com/',
  });
  const imgUrl = body?.data?.wbi_img?.img_url || '';
  const subUrl = body?.data?.wbi_img?.sub_url || '';
  if (!imgUrl || !subUrl) {
    throw new Error('bilibili: cannot extract wbi_img from nav response');
  }
  const imgKey = imgUrl.split('/').pop().split('.')[0];
  const subKey = subUrl.split('/').pop().split('.')[0];
  const mixinRaw = imgKey + subKey;
  let mixinKey = '';
  for (const idx of WBI_MIXIN_KEY_ENC_TAB) {
    mixinKey += mixinRaw[idx] || '';
  }
  cachedWbiKeys = { mixinKey: mixinKey.slice(0, 32) };
  cachedWbiAt = Date.now();
  return cachedWbiKeys;
}

async function signBilibiliParams(params) {
  const { mixinKey } = await getWbiKeys();
  const wts = Math.floor(Date.now() / 1000);
  const merged = { ...params, wts };
  const keys = Object.keys(merged).sort();
  const filtered = keys
    .map((k) => {
      const v = String(merged[k]).replace(/['()!*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    })
    .join('&');
  const w_rid = crypto.createHash('md5').update(filtered + mixinKey).digest('hex');
  return { ...merged, w_rid };
}

// ---------------------------------------------------------------------------
// Bilibili user videos (signed, no cookie needed)
// ---------------------------------------------------------------------------

async function fetchBilibiliUser(mid, days, minLikes, maxPerAccount) {
  if (!/^\d+$/.test(mid)) {
    throw new Error(`bilibili handle must be numeric mid (got "${mid}")`);
  }
  const signed = await signBilibiliParams({
    mid,
    ps: Math.min(30, maxPerAccount * 2),
    pn: 1,
    order: 'pubdate',
    index: 1,
    platform: 'web',
    web_location: 1550101,
  });
  const qs = Object.entries(signed)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const url = `https://api.bilibili.com/x/space/wbi/arc/search?${qs}`;
  const buvidCookie = await getBilibiliBuvid3();
  const body = await fetchJson(url, {
    Referer: `https://space.bilibili.com/${mid}`,
    Origin: 'https://space.bilibili.com',
    Cookie: buvidCookie,
  });
  if (body?.code !== 0) {
    throw new Error(`bilibili code=${body?.code} msg=${body?.message}`);
  }
  const vlist = body?.data?.list?.vlist || [];
  const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
  return vlist
    .filter((v) => v.created >= sinceSec)
    .filter((v) => (v.play || 0) >= minLikes)
    .slice(0, maxPerAccount)
    .map((v) => ({
      title: v.title,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      published_at: new Date(v.created * 1000).toISOString(),
      likes: v.play || 0, // bilibili 用播放量做 minLikes 门槛
      comments: v.comment || 0,
      tags: [],
    }));
}

// ---------------------------------------------------------------------------
// Weibo (requires cookie via env WEIBO_COOKIE)
// ---------------------------------------------------------------------------

async function fetchWeiboUser(uid, days, minLikes, maxPerAccount) {
  const cookie = process.env.WEIBO_COOKIE;
  if (!cookie) {
    const err = new Error('WEIBO_COOKIE env var not set');
    err.code = 'cookie_required';
    throw err;
  }
  if (!/^\d+$/.test(uid)) {
    throw new Error(`weibo handle must be numeric uid (got "${uid}")`);
  }
  const url = `https://weibo.com/ajax/statuses/mymblog?uid=${uid}&page=1&feature=0`;
  const body = await fetchJson(url, { Cookie: cookie, Referer: `https://weibo.com/u/${uid}` });
  const list = body?.data?.list || [];
  const sinceMs = Date.now() - days * 86_400_000;
  return list
    .filter((m) => {
      const ts = new Date(m.created_at).getTime();
      return !isNaN(ts) && ts >= sinceMs;
    })
    .filter((m) => (m.attitudes_count || 0) >= minLikes)
    .slice(0, maxPerAccount)
    .map((m) => ({
      title: (m.text_raw || m.text || '').replace(/<[^>]+>/g, '').slice(0, 200),
      url: `https://weibo.com/${m.user?.idstr || uid}/${m.mblogid}`,
      published_at: new Date(m.created_at).toISOString(),
      likes: m.attitudes_count || 0,
      comments: m.comments_count || 0,
      tags: [],
    }));
}

// ---------------------------------------------------------------------------
// Zhihu (requires cookie via env ZHIHU_COOKIE)
// ---------------------------------------------------------------------------

async function fetchZhihuUser(urlToken, days, minLikes, maxPerAccount) {
  const cookie = process.env.ZHIHU_COOKIE;
  if (!cookie) {
    const err = new Error('ZHIHU_COOKIE env var not set');
    err.code = 'cookie_required';
    throw err;
  }
  const url = `https://www.zhihu.com/api/v4/members/${encodeURIComponent(urlToken)}/answers?offset=0&limit=${maxPerAccount * 2}&sort_by=created&include=data%5B*%5D.voteup_count,comment_count,created_time,question.title,content`;
  const body = await fetchJson(url, {
    Cookie: cookie,
    Referer: `https://www.zhihu.com/people/${encodeURIComponent(urlToken)}`,
    'X-Requested-With': 'fetch',
  });
  const data = body?.data || [];
  const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;
  return data
    .filter((a) => (a.created_time || 0) >= sinceSec)
    .filter((a) => (a.voteup_count || 0) >= minLikes)
    .slice(0, maxPerAccount)
    .map((a) => ({
      title: a.question?.title || '',
      url: `https://www.zhihu.com/question/${a.question?.id || ''}/answer/${a.id}`,
      published_at: new Date((a.created_time || 0) * 1000).toISOString(),
      likes: a.voteup_count || 0,
      comments: a.comment_count || 0,
      tags: [],
    }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const IMPLEMENTED = ['weibo', 'zhihu', 'bilibili'];

async function main() {
  const args = parseArgs();
  if (!args.accountList) return out({ ok: false, error: 'account-list required' }, 2);

  const accounts = parseAccountList(args.accountList);
  const invalid = accounts.filter((a) => !IMPLEMENTED.includes(a.platform));
  if (invalid.length) {
    return out({
      ok: false,
      error: `unsupported platform(s): ${invalid.map((a) => a.raw).join(', ')}`,
      supported: IMPLEMENTED,
    }, 2);
  }

  const by_account = {};
  const errors = {};
  let total = 0;
  for (const acc of accounts) {
    try {
      let items;
      if (acc.platform === 'bilibili') {
        items = await fetchBilibiliUser(acc.handle, args.days, args.minLikes, args.maxPerAccount);
      } else if (acc.platform === 'weibo') {
        items = await fetchWeiboUser(acc.handle, args.days, args.minLikes, args.maxPerAccount);
      } else if (acc.platform === 'zhihu') {
        items = await fetchZhihuUser(acc.handle, args.days, args.minLikes, args.maxPerAccount);
      }
      by_account[acc.raw] = { platform: acc.platform, handle: acc.handle, items };
      total += items.length;
    } catch (e) {
      errors[acc.raw] = {
        platform: acc.platform,
        handle: acc.handle,
        error: e.message,
        code: e.code || undefined,
      };
    }
  }

  out({
    ok: Object.keys(by_account).length > 0,
    fetched_at: new Date().toISOString(),
    source: 'live',
    by_account,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    total_items: total,
  });
}

main().catch((e) => out({ ok: false, error: e.message || String(e) }, 1));
