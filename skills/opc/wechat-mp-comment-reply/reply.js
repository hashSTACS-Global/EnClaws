'use strict';
/**
 * wechat-mp-comment-reply: 回复公众号文章评论（官方 API）
 *
 * Usage:
 *   node reply.js --app-id wx0 --app-secret xxx \
 *     --msg-data-id 2247483650_1 --index 0 \
 *     --user-comment-id 123 --content "感谢关注"
 *
 * Output: single-line JSON
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    appId: null, appSecret: null,
    msgDataId: null, index: 0,
    userCommentId: null, content: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--app-id':           r.appId          = argv[++i]; break;
      case '--app-secret':       r.appSecret      = argv[++i]; break;
      case '--msg-data-id':      r.msgDataId      = argv[++i]; break;
      case '--index':            r.index          = parseInt(argv[++i], 10) || 0; break;
      case '--user-comment-id':  r.userCommentId  = argv[++i]; break;
      case '--content':          r.content        = argv[++i]; break;
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

async function main() {
  const args = parseArgs();
  if (!args.appId)         return out({ ok: false, error: 'app-id required' }, 2);
  if (!args.appSecret)     return out({ ok: false, error: 'app-secret required' }, 2);
  if (!args.msgDataId)     return out({ ok: false, error: 'msg-data-id required' }, 2);
  if (!args.userCommentId) return out({ ok: false, error: 'user-comment-id required' }, 2);
  if (!args.content)       return out({ ok: false, error: 'content required' }, 2);

  try {
    const r = await withTokenRetry(args.appId, args.appSecret, async token => {
      const url = `https://api.weixin.qq.com/cgi-bin/comment/reply/add?access_token=${token}`;
      return httpPostJson(url, {
        msg_data_id: args.msgDataId,
        index: args.index,
        user_comment_id: args.userCommentId,
        content: args.content,
      });
    });

    if (r.errcode && r.errcode !== 0) {
      return out({ ok: false, errcode: r.errcode, errmsg: r.errmsg }, 1);
    }
    out({
      ok: true,
      replied_at: Math.floor(Date.now() / 1000),
      user_comment_id: args.userCommentId,
    });
  } catch (e) {
    out({ ok: false, error: e.message }, 1);
  }
}

main();
