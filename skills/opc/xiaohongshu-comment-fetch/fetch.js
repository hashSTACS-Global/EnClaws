'use strict';
/**
 * xiaohongshu-comment-fetch: 拉小红书笔记评论
 *
 * MVP STATUS: 接口 stub，依赖 src/browser/ 接入。
 */

function parseArgs() {
  const argv = process.argv.slice(2);
  const r = { identityTokenRef: null, noteId: null, userId: null, sinceCursor: null, max: 100 };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--identity-token-ref': r.identityTokenRef = argv[++i]; break;
      case '--note-id':            r.noteId           = argv[++i]; break;
      case '--user-id':            r.userId           = argv[++i]; break;
      case '--since-cursor':       r.sinceCursor      = argv[++i]; break;
      case '--max':                r.max              = parseInt(argv[++i], 10) || 100; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

function main() {
  const args = parseArgs();
  if (!args.identityTokenRef) return out({ ok: false, error: 'identity-token-ref required' }, 2);
  if (!args.noteId && !args.userId) return out({ ok: false, error: 'note-id or user-id required' }, 2);

  out({
    ok: false,
    error: 'NOT_IMPLEMENTED',
    message: '小红书无官方 API，依赖 src/browser/ chrome/cdp 接入。',
    contract: {
      input: args,
      expectedOutput: {
        ok: true,
        fetched_at: '<ISO>',
        new_cursor: '<ISO>',
        comments: [{
          comment_id: '...', note_id: '...',
          author_id: '...', author_nickname: '...',
          content: '...', created_at: '<ISO>',
          liked_count: 0, replies: [],
        }],
        count: 0,
      },
    },
  }, 1);
}

main();
