'use strict';
/**
 * wechat-mp-publish: 微信公众号官方 API 封装
 *
 * Actions:
 *   create-draft    - 创建草稿
 *   publish         - 把草稿发出去
 *   upload-cover    - 上传永久图片素材（拿 media_id）
 *   stats           - 拉文章统计（MVP：返回 placeholder，公众号 stats 接口较复杂）
 *
 * Usage:
 *   node publish.js --action create-draft --app-id wx0 --app-secret xxx \
 *     --title "..." --content "..." --cover-media-id ...
 *
 * Output: single-line JSON
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    action: null,
    appId: null,
    appSecret: null,
    title: null,
    content: null,
    contentFile: null,
    coverMediaId: null,
    author: null,
    digest: null,
    sourceUrl: null,
    mediaId: null,
    imagePath: null,
    since: null,
    until: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--action':          r.action       = argv[++i]; break;
      case '--app-id':          r.appId        = argv[++i]; break;
      case '--app-secret':      r.appSecret    = argv[++i]; break;
      case '--title':           r.title        = argv[++i]; break;
      case '--content':         r.content      = argv[++i]; break;
      case '--content-file':    r.contentFile  = argv[++i]; break;
      case '--cover-media-id':  r.coverMediaId = argv[++i]; break;
      case '--author':          r.author       = argv[++i]; break;
      case '--digest':          r.digest       = argv[++i]; break;
      case '--source-url':      r.sourceUrl    = argv[++i]; break;
      case '--media-id':        r.mediaId      = argv[++i]; break;
      case '--image-path':      r.imagePath    = argv[++i]; break;
      case '--since':           r.since        = argv[++i]; break;
      case '--until':           r.until        = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`parse json failed: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function httpPostJson(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`parse json failed: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function httpPostMultipart(url, fieldName, filePath) {
  return new Promise((resolve, reject) => {
    const boundary = '----enclaws' + Date.now().toString(16);
    const filename = path.basename(filePath);
    let fileBuf;
    try { fileBuf = fs.readFileSync(filePath); }
    catch (e) { return reject(e); }

    const head = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, fileBuf, tail]);

    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`parse json failed: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// access_token (cached)
// ---------------------------------------------------------------------------

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
      if (c.expires_at && c.expires_at > Date.now() + 60_000) {
        return c.access_token;
      }
    } catch (_) {}
  }

  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const r = await httpGetJson(url);
  if (!r.access_token) {
    throw new Error(`get_token_failed: ${JSON.stringify(r)}`);
  }
  fs.writeFileSync(cp, JSON.stringify({
    access_token: r.access_token,
    expires_at: Date.now() + (r.expires_in - 300) * 1000, // 留 5 分钟 buffer
  }));
  return r.access_token;
}

// Wrapper: 若 API 返回 40001 (token 失效)，自动刷新重试一次
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
// Actions
// ---------------------------------------------------------------------------

async function doUploadCover(args) {
  if (!args.imagePath) throw new Error('image-path required');
  if (!fs.existsSync(args.imagePath)) throw new Error(`image not found: ${args.imagePath}`);

  const r = await withTokenRetry(args.appId, args.appSecret, async token => {
    const url = `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`;
    return httpPostMultipart(url, 'media', args.imagePath);
  });

  if (r.errcode && r.errcode !== 0) {
    return { ok: false, errcode: r.errcode, errmsg: r.errmsg };
  }
  return { ok: true, media_id: r.media_id, url: r.url };
}

async function doCreateDraft(args) {
  if (!args.title)        throw new Error('title required');
  if (!args.coverMediaId) throw new Error('cover-media-id required');

  let content = args.content;
  if (!content && args.contentFile) {
    content = fs.readFileSync(args.contentFile, 'utf8');
  }
  if (!content) throw new Error('content or content-file required');

  const r = await withTokenRetry(args.appId, args.appSecret, async token => {
    const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
    return httpPostJson(url, {
      articles: [{
        title: args.title,
        author: args.author || '',
        content,
        thumb_media_id: args.coverMediaId,
        digest: args.digest || '',
        content_source_url: args.sourceUrl || '',
        need_open_comment: 1,
        only_fans_can_comment: 0,
      }],
    });
  });

  if (r.errcode && r.errcode !== 0) {
    return { ok: false, errcode: r.errcode, errmsg: r.errmsg };
  }
  return { ok: true, media_id: r.media_id, title: args.title };
}

async function doPublish(args) {
  if (!args.mediaId) throw new Error('media-id required');

  const r = await withTokenRetry(args.appId, args.appSecret, async token => {
    const url = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`;
    return httpPostJson(url, { media_id: args.mediaId });
  });

  if (r.errcode && r.errcode !== 0) {
    return { ok: false, errcode: r.errcode, errmsg: r.errmsg };
  }
  return { ok: true, publish_id: r.publish_id, msg_data_id: r.msg_data_id };
}

async function doStats(args) {
  // MVP: 公众号的文章级统计接口（数据分析接口）需要较多配置；本期先返回 placeholder
  // 真实实现可以：
  //   1. /datacube/getuserread  用户阅读
  //   2. /datacube/getuserreadhour
  //   3. 或 /cgi-bin/material/get_article + 群发 stats
  return {
    ok: false,
    errcode: 'NOT_IMPLEMENTED_MVP',
    errmsg: 'stats 接口在 MVP 阶段未实现。推荐在公众号后台手动导出或接入 /datacube/ 系列接口',
    hint: '财务助理 MVP 可以先从老板手贴的 income/raw/ 取数',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();

  if (!args.action)    return out({ ok: false, error: 'action required' }, 2);
  if (!args.appId)     return out({ ok: false, error: 'app-id required' }, 2);
  if (!args.appSecret) return out({ ok: false, error: 'app-secret required' }, 2);

  try {
    let result;
    switch (args.action) {
      case 'upload-cover': result = await doUploadCover(args); break;
      case 'create-draft': result = await doCreateDraft(args); break;
      case 'publish':      result = await doPublish(args);     break;
      case 'stats':        result = await doStats(args);       break;
      default:
        return out({ ok: false, error: `unknown action: ${args.action}` }, 2);
    }
    out(result, result.ok ? 0 : 1);
  } catch (e) {
    out({ ok: false, error: e.message }, 1);
  }
}

main();
