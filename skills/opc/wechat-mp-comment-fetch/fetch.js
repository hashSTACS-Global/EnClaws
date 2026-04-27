'use strict';
/**
 * wechat-mp-comment-fetch: 拉公众号文章评论（官方 API）
 *
 * Usage:
 *   node fetch.js --app-id wx0 --app-secret xxx \
 *     --msg-data-id 2247483650_1 --index 0 --begin 0 --count 50
 *
 * Output: single-line JSON
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    appId: null, appSecret: null,
    msgDataId: null, index: 0,
    begin: 0, count: 50,
    type: 'all',
    since: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--app-id':       r.appId     = argv[++i]; break;
      case '--app-secret':   r.appSecret = argv[++i]; break;
      case '--msg-data-id':  r.msgDataId = argv[++i]; break;
      case '--index':        r.index     = parseInt(argv[++i], 10) || 0; break;
      case '--begin':        r.begin     = parseInt(argv[++i], 10) || 0; break;
      case '--count':        r.count     = parseInt(argv[++i], 10) || 50; break;
      case '--type':         r.type      = argv[++i]; break;
      case '--since':        r.since     = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0,200))); } });
    }).on('error', reject);
  });
}

function httpPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0,200))); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// token cache shared with wechat-mp-publish
function tokenCachePath(appId) {
  const dir = path.join(os.homedir(), '.enclaws', 'wechat-mp');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${appId}.json`);
}

async function getAccessToken(appId, appSecret, force = false) {
  const cp = tokenCachePath(appId);
  if (!force && fs.existsSync(cp)) {
    try {
      const c = JSON.parse(fs.readFileSync(cp, 'utf8'));
      if (c.expires_at && c.expires_at > Date.now() + 60_000) return c.access_token;
    } catch (_) {}
  }
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const r = await httpGetJson(url);
  if (!r.access_token) throw new Error(`get_token_failed: ${JSON.stringify(r)}`);
  fs.writeFileSync(cp, JSON.stringify({
    access_token: r.access_token,
    expires_at: Date.now() + (r.expires_in - 300) * 1000,
  }));
  return r.access_token;
}

async function withTokenRetry(appId, appSecret, fn) {
  let token = await getAccessToken(appId, appSecret);
  let r = await fn(token);
  if (r && r.errcode === 40001) {
    token = await getAccessToken(appId, appSecret, true);
    r = await fn(token);
  }
  return r;
}

// ---------------------------------------------------------------------------

const TYPE_MAP = { all: 0, normal: 2, elected: 4 };

async function fetchComments(args) {
  const typeCode = TYPE_MAP[args.type];
  if (typeCode === undefined) {
    return { ok: false, error: `invalid type: ${args.type}. Allowed: all, normal, elected` };
  }

  const r = await withTokenRetry(args.appId, args.appSecret, async token => {
    const url = `https://api.weixin.qq.com/cgi-bin/comment/list?access_token=${token}`;
    return httpPostJson(url, {
      msg_data_id: args.msgDataId,
      index: args.index,
      begin: args.begin,
      count: args.count,
      type: typeCode,
    });
  });

  if (r.errcode && r.errcode !== 0) {
    return { ok: false, errcode: r.errcode, errmsg: r.errmsg };
  }

  // Normalize shape
  const comments = (r.comment || []).map(c => ({
    comment_id: c.user_comment_id,
    author_openid: c.openid,
    author_nickname: c.nick_name,
    content: c.content,
    created_at: c.create_time,
    is_top: !!c.is_top,
    liked_count: c.like_num || 0,
    replies: (c.reply && c.reply.reply_list) || [],
  }));

  // 可选按 since 过滤
  let filtered = comments;
  if (args.since) {
    const sinceSec = Math.floor(new Date(args.since).getTime() / 1000);
    filtered = comments.filter(c => c.created_at >= sinceSec);
  }

  return {
    ok: true,
    comments: filtered,
    has_more: r.total > args.begin + r.comment.length,
    total: r.total,
  };
}

async function main() {
  const args = parseArgs();
  if (!args.appId)     return out({ ok: false, error: 'app-id required' }, 2);
  if (!args.appSecret) return out({ ok: false, error: 'app-secret required' }, 2);
  if (!args.msgDataId) return out({ ok: false, error: 'msg-data-id required' }, 2);

  try {
    const r = await fetchComments(args);
    out(r, r.ok ? 0 : 1);
  } catch (e) {
    out({ ok: false, error: e.message }, 1);
  }
}

main();
