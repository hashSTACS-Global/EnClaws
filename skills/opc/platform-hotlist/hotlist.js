'use strict';
/**
 * platform-hotlist: 抓平台热榜前 N 条
 *
 * 实现情况（2026-04-23）：
 *   - weibo    → 真实：https://weibo.com/ajax/side/hotSearch（公开 JSON，无需 auth）
 *   - zhihu    → 真实：https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total
 *   - bilibili → 真实：https://api.bilibili.com/x/web-interface/popular
 *   - xiaohongshu / douyin / wechat_mp → 无公开 API，需要 browser automation（Phase 2）
 *
 * 调用方式：node hotlist.js --platform weibo --top-n 30
 * 输出：single-line JSON（ok:true/false + items[]）
 */

const https = require('node:https');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = { platform: null, topN: 50, verticalKeywords: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--platform':          r.platform         = argv[++i]; break;
      case '--top-n':             r.topN             = parseInt(argv[++i], 10) || 50; break;
      case '--vertical-keywords': r.verticalKeywords = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
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
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchJson(url, headers = {}) {
  const r = await fetchRaw(url, headers);
  if (r.status < 200 || r.status >= 300) {
    throw new Error(`http ${r.status} from ${url}`);
  }
  try {
    return JSON.parse(r.body);
  } catch (e) {
    throw new Error(`invalid json from ${url}: ${r.body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Platform scrapers — all return Array<HotItem> with a uniform shape
// ---------------------------------------------------------------------------

async function fetchWeibo(topN) {
  // 微博侧栏热搜接口（无需登录）
  const body = await fetchJson('https://weibo.com/ajax/side/hotSearch', {
    Referer: 'https://weibo.com/',
  });
  const realtime = body?.data?.realtime;
  if (!Array.isArray(realtime)) {
    throw new Error('weibo: unexpected response shape');
  }
  return realtime
    .filter((e) => e && typeof e.word === 'string' && e.word.trim())
    .slice(0, topN)
    .map((item, i) => ({
      rank: i + 1,
      title: item.word,
      author: null,
      url: `https://s.weibo.com/weibo?q=%23${encodeURIComponent(item.word)}%23`,
      heat_score: typeof item.num === 'number' ? item.num : 0,
      excerpt: item.category || '',
      tags: item.flag_desc ? [item.flag_desc] : [],
    }));
}

const ZHIHU_MOBILE_UA =
  'osee2unifiedRelease/99352 osee2unifiedReleaseVersion/10.36.0 ' +
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) ' +
  'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

async function fetchZhihu(topN) {
  // 知乎手机端 API（无需 cookie；桌面端 v3 会 401）
  const body = await fetchJson(
    `https://api.zhihu.com/topstory/hot-list?limit=${Math.min(50, topN)}&reverse_order=0`,
    { 'User-Agent': ZHIHU_MOBILE_UA },
  );
  const data = body?.data;
  if (!Array.isArray(data)) {
    throw new Error('zhihu: unexpected response shape');
  }
  return data
    .filter((e) => e && e.target)
    .slice(0, topN)
    .map((entry, i) => {
      const target = entry.target || {};
      const title = target.title || '';
      const excerpt = typeof target.excerpt === 'string' ? target.excerpt : '';
      // detail_text e.g. "456 万热度"
      const detailText = entry.detail_text || '';
      const heatMatch = detailText.match(/([\d.]+)\s*万/);
      const heatScore = heatMatch ? parseFloat(heatMatch[1]) * 10000 : 0;
      return {
        rank: i + 1,
        title,
        author: null,
        url: resolveZhihuUrl(entry, target, title),
        heat_score: heatScore,
        excerpt,
        tags: [],
      };
    });
}

/**
 * Resolving a zhihu hot-list item's user-facing URL is surprisingly tricky:
 *   - API URLs (api.zhihu.com/*) require signed auth params and return
 *     "请求参数异常，请升级客户端" when opened in a browser → not usable
 *   - Long ids (>=12 digits) are usually news/feed/story ids, NOT question ids.
 *     Pasting them into /question/{id} gives a dead page.
 *   - Standard question ids are 9-10 digits; answer/article/pin ids similar.
 *
 * Strategy: be strict about when we construct a direct URL. When in doubt,
 * fall back to the search URL — it always works and lands on something
 * related.
 */
function resolveZhihuUrl(entry, target, title) {
  const urlCandidates = [
    typeof target?.url === 'string' ? target.url : null,
    typeof target?.link?.url === 'string' ? target.link.url : null,
  ].filter(Boolean);

  // 1. Use explicit URL only if it's a user-facing zhihu.com page, not an API
  for (const raw of urlCandidates) {
    if (isUsableZhihuUserUrl(raw)) return raw;
  }

  // 2. Construct from type + id. Only accept ids that fit the expected shape
  //    for that type, so we don't generate /question/2030338702908594200
  //    (a feed id masquerading as a question id).
  const t = target?.type || '';
  const id = target?.id;
  if (id) {
    const idStr = String(id);
    const isQuestionShaped = /^\d{6,11}$/.test(idStr); // real question ids are ~9-10 digits

    if (t === 'answer' && target.question?.id && /^\d{6,11}$/.test(String(target.question.id))) {
      return `https://www.zhihu.com/question/${target.question.id}/answer/${id}`;
    }
    if (t === 'article' && isQuestionShaped) {
      return `https://zhuanlan.zhihu.com/p/${id}`;
    }
    if (t === 'pin' && isQuestionShaped) {
      return `https://www.zhihu.com/pin/${id}`;
    }
    if (t === 'question' && isQuestionShaped) {
      return `https://www.zhihu.com/question/${id}`;
    }
    // No other type/id combo gives a reliable URL — falls through to search.
  }

  // 3. Search URL — lands on a results page listing content matching the title.
  return `https://www.zhihu.com/search?q=${encodeURIComponent(title || '')}&type=content`;
}

function isUsableZhihuUserUrl(u) {
  if (typeof u !== 'string' || !u.startsWith('http')) return false;
  try {
    const parsed = new URL(u);
    const host = parsed.hostname.toLowerCase();
    // API domains require signed params — not usable in a browser link
    if (host.startsWith('api.') || host.startsWith('www.api.')) return false;
    // Only accept zhihu.com and its public subdomains
    return host === 'zhihu.com' || host.endsWith('.zhihu.com');
  } catch {
    return false;
  }
}

async function fetchBilibili(topN) {
  // B 站综合热门（公开 API，无需 auth）
  const body = await fetchJson(
    `https://api.bilibili.com/x/web-interface/popular?ps=${Math.min(50, topN)}&pn=1`,
    { Referer: 'https://www.bilibili.com/v/popular/all' },
  );
  if (body?.code !== 0 || !Array.isArray(body?.data?.list)) {
    throw new Error(`bilibili: unexpected response code=${body?.code}`);
  }
  return body.data.list.slice(0, topN).map((v, i) => ({
    rank: i + 1,
    title: v.title,
    author: v.owner?.name || null,
    url: v.short_link_v2 || `https://www.bilibili.com/video/${v.bvid}`,
    heat_score: v.stat?.view || 0,
    excerpt: (v.desc || '').slice(0, 120),
    tags: v.tname ? [v.tname] : [],
  }));
}

// ---------------------------------------------------------------------------
// Vertical keyword filter (soft — agent can still process all items)
// ---------------------------------------------------------------------------

function filterByKeywords(items, verticalKeywords) {
  if (!verticalKeywords) return items;
  const kws = verticalKeywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  if (kws.length === 0) return items;
  return items.map((item) => ({
    ...item,
    vertical_match: kws.some(
      (kw) => item.title.includes(kw) || (item.excerpt && item.excerpt.includes(kw)),
    ),
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const IMPLEMENTED = ['weibo', 'zhihu', 'bilibili'];
const BROWSER_REQUIRED = ['xiaohongshu', 'douyin', 'wechat_mp'];

async function main() {
  const args = parseArgs();
  if (!args.platform) return out({ ok: false, error: 'platform required' }, 2);

  if (BROWSER_REQUIRED.includes(args.platform)) {
    return out({
      ok: false,
      error: 'browser_automation_required',
      platform: args.platform,
      message:
        `${args.platform} 无公开热榜 API，需要基于 src/browser/（chrome/cdp）的真实爬虫（Phase 2 接入）。` +
        `当前可用平台：${IMPLEMENTED.join(', ')}。请改用它们或在 inspiration/ 贴手动选题。`,
      supported_now: IMPLEMENTED,
    }, 1);
  }

  if (!IMPLEMENTED.includes(args.platform)) {
    return out({
      ok: false,
      error: `unsupported platform: ${args.platform}`,
      supported: [...IMPLEMENTED, ...BROWSER_REQUIRED],
    }, 2);
  }

  const topN = Math.max(1, Math.min(50, args.topN));
  let items;
  try {
    if (args.platform === 'weibo')         items = await fetchWeibo(topN);
    else if (args.platform === 'zhihu')    items = await fetchZhihu(topN);
    else if (args.platform === 'bilibili') items = await fetchBilibili(topN);
  } catch (e) {
    return out({
      ok: false,
      error: 'fetch_failed',
      platform: args.platform,
      message: e.message,
    }, 1);
  }

  items = filterByKeywords(items, args.verticalKeywords);

  out({
    ok: true,
    platform: args.platform,
    fetched_at: new Date().toISOString(),
    source: 'live',
    items,
  });
}

main().catch((e) => out({ ok: false, error: e.message || String(e) }, 1));
