'use strict';
/**
 * compliance-check: 本地词库扫描输出结构化风险报告
 *
 * Usage:
 *   node check.js --text "..." --level finance
 *   node check.js --text-file "/tmp/draft.md" --level general
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
  const r = { text: null, textFile: null, level: 'general' };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--text':      r.text     = argv[++i]; break;
      case '--text-file': r.textFile = argv[++i]; break;
      case '--level':     r.level    = argv[++i]; break;
    }
  }
  return r;
}

function out(obj, code = 0) {
  process.stdout.write(JSON.stringify(obj) + '\n');
  if (code) process.exit(code);
}

// ---------------------------------------------------------------------------
// Lexicon loading (general 始终加载，再叠加 level)
// ---------------------------------------------------------------------------

function loadLexicon(level) {
  const lexDir = path.join(__dirname, 'lexicons');
  const levels = ['general'];
  if (level && level !== 'general') levels.push(level);

  const merged = { categories: {} };
  for (const lvl of levels) {
    const fp = path.join(lexDir, `${lvl}.json`);
    if (!fs.existsSync(fp)) continue;
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    for (const [cat, data] of Object.entries(raw.categories || {})) {
      if (!merged.categories[cat]) {
        merged.categories[cat] = { severity: data.severity, terms: [] };
      }
      merged.categories[cat].terms.push(...(data.terms || []));
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

function scan(text, lex) {
  const hits = [];
  for (const [category, { severity, terms }] of Object.entries(lex.categories)) {
    for (const term of terms) {
      let idx = 0;
      while ((idx = text.indexOf(term, idx)) !== -1) {
        hits.push({ term, category, severity, position: idx });
        idx += term.length;
      }
    }
  }
  // 按 position 排序，便于阅读
  hits.sort((a, b) => a.position - b.position);
  return hits;
}

function judgeRisk(hits) {
  const severe = hits.filter(h => h.severity === 'severe').length;
  const warn   = hits.filter(h => h.severity === 'warning').length;
  if (severe >= 1) return 'high';
  if (warn   >= 2) return 'mid';
  return 'low';
}

function makeSuggestion(hits, risk) {
  if (risk === 'high') {
    const severeTerms = [...new Set(hits.filter(h => h.severity === 'severe').map(h => h.term))];
    return `去掉或改写严重命中词: ${severeTerms.join('、')}`;
  }
  if (risk === 'mid') {
    const warnTerms = [...new Set(hits.filter(h => h.severity === 'warning').map(h => h.term))];
    return `多个敏感词命中，建议审慎措辞: ${warnTerms.join('、')}`;
  }
  return '合规检查通过';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  let args;
  try {
    args = parseArgs();
  } catch (e) {
    out({ ok: false, error: `bad args: ${e.message}` }, 2);
    return;
  }

  let text = args.text;
  if (!text && args.textFile) {
    try {
      text = fs.readFileSync(args.textFile, 'utf8');
    } catch (e) {
      out({ ok: false, error: `read text-file failed: ${e.message}` }, 1);
      return;
    }
  }
  if (!text) {
    out({ ok: false, error: 'text or text-file required' }, 2);
    return;
  }

  const levels = ['general', 'finance', 'medical', 'law'];
  if (!levels.includes(args.level)) {
    out({ ok: false, error: `invalid level: ${args.level}. Allowed: ${levels.join(', ')}` }, 2);
    return;
  }

  let lex;
  try {
    lex = loadLexicon(args.level);
  } catch (e) {
    out({ ok: false, error: `load lexicon failed: ${e.message}` }, 1);
    return;
  }

  const hits = scan(text, lex);
  const risk = judgeRisk(hits);
  const suggestion = makeSuggestion(hits, risk);

  out({
    ok: true,
    level: args.level,
    risk,
    hits,
    suggestion,
  });
}

main();
