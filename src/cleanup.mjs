// Deletes the losing branches of one experiment from source files. Deterministic, no LLM.
//
// It understands one pattern, the `pick` helper:
//     const flag = await flags.getExperimentFlag('invite_cta', userId);
//     const label = pick(flag, { control: 'Invite your teammates', short: 'Send invite' });
// and rewrites it to the winning entry. If the flag read is then unused, that line goes too.
// Anything else that still mentions the flag is reported, not guessed at.
import fs from 'node:fs';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.lastcall', 'verification', 'test', 'scripts', '.github']);
const EXT = /\.(mjs|cjs|js|jsx|ts|tsx)$/;

export function findFiles(root, flag) {
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
      if (!EXT.test(e.name)) continue;
      const file = path.join(dir, e.name);
      if (fs.readFileSync(file, 'utf8').includes(flag)) hits.push(file);
    }
  })(root);
  return hits;
}

// Scans from an opening bracket to its match, skipping strings, template literals and comments.
function matchClose(src, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' }; const stack = [];
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === ')' || ch === '}' || ch === ']') { if (stack.pop() !== ch) return -1; if (!stack.length) return i; }
  }
  return -1;
}
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = matchClose(src, j + 1); continue; }
    if (src[j] === q) return j;
  }
  return src.length;
}
// Splits "a: 1, b: fn(x, y)" on top-level commas.
function splitTop(body, sep) {
  const parts = []; let last = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(body, i); continue; }
    if (ch === '(' || ch === '{' || ch === '[') { i = matchClose(body, i); if (i < 0) return null; continue; }
    if (ch === sep) { parts.push(body.slice(last, i)); last = i + 1; }
  }
  parts.push(body.slice(last));
  return parts;
}

export function collapse(source, flag, winner) {
  let src = source; const notes = []; let changed = 0;
  // 1. variables that hold this flag: const x = await anything.getExperimentFlag('flag', ...)
  const readRe = new RegExp(`^[ \\t]*(?:const|let)\\s+(\\w+)\\s*=\\s*(?:await\\s+)?[\\w.]+\\.(?:getExperimentFlag|useExperiment)\\(\\s*['"\`]${flag}['"\`][^\\n]*\\);?[ \\t]*\\n`, 'gm');
  const vars = [...src.matchAll(readRe)].map((m) => ({ name: m[1], line: m[0] }));
  // 2. pick(<var or var.value>, { ... }) -> winning entry
  for (const v of vars) {
    const pickRe = new RegExp(`\\bpick\\(\\s*${v.name}(?:\\.value)?\\s*,\\s*\\{`, 'g');
    let m;
    while ((m = pickRe.exec(src))) {
      const open = m.index + m[0].length - 1; const close = matchClose(src, open);
      const callClose = close < 0 ? -1 : src.indexOf(')', close);
      if (close < 0 || callClose < 0 || src.slice(close + 1, callClose).trim().replace(',', '') !== '') { notes.push(`could not parse a pick() call for ${flag}`); break; }
      const entries = splitTop(src.slice(open + 1, close), ',');
      const map = {};
      for (const e of entries || []) { const t = e.trim(); if (!t) continue; const kv = t.match(/^(?:['"]?)([\w-]+)(?:['"]?)\s*:\s*([\s\S]+)$/); if (kv) map[kv[1]] = kv[2].trim(); }
      if (!(winner in map)) { notes.push(`pick() for ${flag} has no "${winner}" entry; left untouched`); break; }
      src = src.slice(0, m.index) + map[winner] + src.slice(callClose + 1);
      changed++; pickRe.lastIndex = 0;
    }
  }
  // 3. drop the flag read when nothing uses it any more
  for (const v of vars) {
    const uses = (src.match(new RegExp(`\\b${v.name}\\b`, 'g')) || []).length;
    if (changed && uses === 1) { src = src.replace(v.line, ''); changed++; }
  }
  // 4. drop the pick import when it is unused
  if (changed && !/\bpick\(/.test(src)) src = src.replace(/^import\s*\{\s*pick\s*\}\s*from\s*['"][^'"]+['"];?[ \t]*\n(?:[ \t]*\n)?/m, '');
  const leftover = src.split('\n').map((l, i) => (l.includes(flag) ? i + 1 : 0)).filter(Boolean);
  return { source: src, changed: changed > 0, leftoverLines: leftover, notes };
}

export function planCleanup(root, flag, winner) {
  return findFiles(root, flag).map((file) => {
    const before = fs.readFileSync(file, 'utf8'); const r = collapse(before, flag, winner);
    return { file: path.relative(root, file), before, after: r.source, changed: r.changed, leftoverLines: r.leftoverLines, notes: r.notes };
  });
}
