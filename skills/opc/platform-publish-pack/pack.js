'use strict';
/**
 * platform-publish-pack: 为半自动平台生成标准 markdown 发布包
 *
 * Usage:
 *   node pack.js --platform xiaohongshu --title "..." --body "..." \
 *     --hashtags "#a,#b" --output-dir "/path" --short-id "a3f2"
 *
 * Output: single-line JSON
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = {
    platform: null,
    title: null,
    body: null,
    bodyFile: null,
    hashtags: null,
    coverHint: null,
    coverUrl: null,
    outputDir: null,
    shortId: null,
    draftRef: null,
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--platform':    r.platform    = argv[++i]; break;
      case '--title':       r.title       = argv[++i]; break;
      case '--body':        r.body        = argv[++i]; break;
      case '--body-file':   r.bodyFile    = argv[++i]; break;
      case '--hashtags':    r.hashtags    = argv[++i]; break;
      case '--cover-hint':  r.coverHint   = argv[++i]; break;
      case '--cover-url':   r.coverUrl    = argv[++i]; break;
      case '--output-dir':  r.outputDir   = argv[++i]; break;
      case '--short-id':    r.shortId     = argv[++i]; break;
      case '--draft-ref':   r.draftRef    = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

const PLATFORM_TITLES = {
  xiaohongshu: '小红书',
  shipinhao:   '视频号',
  douyin:      '抖音',
  zhihu:       '知乎',
  bilibili:    'B 站',
};

function todayDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function nowIso() {
  const d = new Date();
  const tz = -d.getTimezoneOffset();
  const sign = tz >= 0 ? '+' : '-';
  const hh = String(Math.floor(Math.abs(tz) / 60)).padStart(2, '0');
  const mm = String(Math.abs(tz) % 60).padStart(2, '0');
  const iso = d.toISOString().split('.')[0];
  return `${iso}${sign}${hh}:${mm}`;
}

function parseHashtags(s) {
  if (!s) return [];
  return s.split(',').map(t => t.trim()).filter(Boolean);
}

function buildFrontmatter(o) {
  const lines = ['---'];
  lines.push(`type: publish_pack`);
  lines.push(`platform: ${o.platform}`);
  lines.push(`title: ${JSON.stringify(o.title)}`);
  lines.push(`hashtags: [${o.hashtags.map(t => JSON.stringify(t)).join(', ')}]`);
  if (o.coverHint) lines.push(`cover_hint: ${JSON.stringify(o.coverHint)}`);
  if (o.coverUrl)  lines.push(`cover_url: ${JSON.stringify(o.coverUrl)}`);
  lines.push(`status: pending_user_publish`);
  if (o.draftRef)  lines.push(`draft_ref: ${JSON.stringify(o.draftRef)}`);
  lines.push(`generated_at: "${nowIso()}"`);
  lines.push('---');
  return lines.join('\n');
}

function buildBody(o) {
  const platformLabel = PLATFORM_TITLES[o.platform] || o.platform;
  const hashtagsLine = o.hashtags.length ? o.hashtags.join(' ') : '_（无）_';

  const chunks = [];
  chunks.push(`# 📋 发布包：${platformLabel}`);
  chunks.push('');
  chunks.push('## 1. 标题（复制到 App）');
  chunks.push('');
  chunks.push('> ' + o.title);
  chunks.push('');
  chunks.push('## 2. 正文（复制到 App）');
  chunks.push('');
  chunks.push('```');
  chunks.push(o.body);
  chunks.push('```');
  chunks.push('');
  chunks.push('## 3. 标签（附加在正文末尾）');
  chunks.push('');
  chunks.push(hashtagsLine);
  chunks.push('');

  if (o.coverHint || o.coverUrl) {
    chunks.push('## 4. 封面图');
    chunks.push('');
    if (o.coverUrl)  chunks.push(`- URL：${o.coverUrl}`);
    if (o.coverHint) chunks.push(`- 提示：${o.coverHint}`);
    chunks.push('');
  }

  chunks.push('## 5. 发布步骤');
  chunks.push('');
  chunks.push('- [ ] 复制标题');
  chunks.push('- [ ] 复制正文');
  chunks.push('- [ ] 复制标签');
  chunks.push('- [ ] 准备/上传封面图');
  chunks.push(`- [ ] 在${platformLabel} App 发布`);
  chunks.push('- [ ] 回 OPC portal 点「我已发布」');
  chunks.push('');

  return chunks.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs();

  // Validate
  if (!args.platform) return out({ ok: false, error: 'platform required' }, 2);
  if (!args.title)    return out({ ok: false, error: 'title required' }, 2);
  if (!args.outputDir) return out({ ok: false, error: 'output-dir required' }, 2);
  if (!args.shortId)  return out({ ok: false, error: 'short-id required' }, 2);

  let body = args.body;
  if (!body && args.bodyFile) {
    try {
      body = fs.readFileSync(args.bodyFile, 'utf8');
    } catch (e) {
      return out({ ok: false, error: `read body-file failed: ${e.message}` }, 1);
    }
  }
  if (!body) return out({ ok: false, error: 'body or body-file required' }, 2);

  const hashtags = parseHashtags(args.hashtags);

  // Output path
  const filename = `${todayDate()}-${args.shortId}-${args.platform}.md`;
  const outPath = path.join(args.outputDir, filename);

  try {
    fs.mkdirSync(args.outputDir, { recursive: true });
  } catch (e) {
    return out({ ok: false, error: `mkdir failed: ${e.message}` }, 1);
  }

  const content = buildFrontmatter({
    platform: args.platform,
    title: args.title,
    hashtags,
    coverHint: args.coverHint,
    coverUrl: args.coverUrl,
    draftRef: args.draftRef,
  }) + '\n\n' + buildBody({
    platform: args.platform,
    title: args.title,
    body,
    hashtags,
    coverHint: args.coverHint,
    coverUrl: args.coverUrl,
  });

  try {
    fs.writeFileSync(outPath, content);
  } catch (e) {
    return out({ ok: false, error: `write failed: ${e.message}` }, 1);
  }

  out({
    ok: true,
    path: outPath,
    platform: args.platform,
    filename,
    bytes: Buffer.byteLength(content),
  });
}

main();
