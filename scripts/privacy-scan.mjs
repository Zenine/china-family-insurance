#!/usr/bin/env node
// 用法: node scripts/privacy-scan.mjs <dir...> [--blacklist file]
// 命中身份证样式、手机号、保单号后 8 位以上数字或黑名单词时退出码 1。

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.superpowers']);

const RULES = [
  ['id-card', /(?<!\d)\d{17}[\dXx](?!\d)/g],
  ['mobile', /(?<!\d)1[3-9]\d{9}(?!\d)/g],
  ['policy-number', /保单号[^\n]*?(\d{8,})/g],
];

export function scanText(text, blacklist = []) {
  const hits = [];
  for (const [rule, re] of RULES) {
    for (const m of text.matchAll(re)) {
      hits.push({ rule, match: rule === 'policy-number' ? m[1] : m[0] });
    }
  }
  for (const word of blacklist) {
    if (word.trim() && text.includes(word)) hits.push({ rule: 'blacklist', match: word });
  }
  return hits;
}

async function* walk(target) {
  const entries = await readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function isBinary(buf) {
  return buf.subarray(0, 8192).includes(0);
}

async function main() {
  const args = process.argv.slice(2);
  const dirs = [];
  let blacklistFile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--blacklist') blacklistFile = args[++i];
    else dirs.push(args[i]);
  }
  if (dirs.length === 0) {
    console.error('用法: node scripts/privacy-scan.mjs <dir...> [--blacklist file]');
    process.exit(2);
  }
  const blacklist = blacklistFile
    ? (await readFile(blacklistFile, 'utf8')).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'))
    : [];
  let total = 0;
  for (const dir of dirs) {
    for await (const file of walk(dir)) {
      const buf = await readFile(file);
      if (isBinary(buf)) continue;
      for (const hit of scanText(buf.toString('utf8'), blacklist)) {
        console.log(`${file}: ${hit.rule}: ${hit.match}`);
        total++;
      }
    }
  }
  process.exit(total > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (err) {
    console.error(`失败: ${err.message}`);
    process.exit(2);
  }
}
