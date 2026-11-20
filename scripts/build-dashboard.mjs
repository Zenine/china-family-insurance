#!/usr/bin/env node
// 用法: node scripts/build-dashboard.mjs <库目录> [--out <输出文件>]
// 生成 <库目录>/site/index.html：明文总览 + 口令加密的明细。
// --out 改写输出位置：只接受库目录内、以 .html 结尾的相对路径。
// 口令来源: DASHBOARD_PASSPHRASE → <库目录>/.private/dashboard-passphrase → 交互输入。

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encryptText, decryptPayload, resolvePassphrase } from './lib/crypto.mjs';
import { buildDashboardData } from './lib/dashboard-data.mjs';

const TEMPLATE = fileURLToPath(new URL('../dashboard/index.html', import.meta.url));
const INJECTION = {
  overview: /^(\s*)const DASHBOARD_OVERVIEW = .*;$/m,
  encrypted: /^(\s*)const ENCRYPTED_DASHBOARD = .*;$/m
};

function runGit(cwd, args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return spawnSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// 库在 git 工作树内时，.private/ 必须被忽略；不在 git 仓库则跳过。
function assertPrivateIgnored(libraryDir) {
  const inside = runGit(libraryDir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return;
  const check = runGit(libraryDir, ['check-ignore', '-q', '.private/x']);
  if (check.status === 0) return;
  if (check.status === 1) throw new Error('.private/ 未被 git 忽略，请先在 .gitignore 中加入 .private/');
  throw new Error(`git check-ignore 执行失败: ${check.stderr.trim()}`);
}

// 注入到 <script> 内的 JSON：转义 <，避免 </script> 或 <!-- 打断脚本。
function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function inject(template, pattern, name, value) {
  if (!pattern.test(template)) throw new Error(`模板缺少注入行 const ${name} = …;`);
  return template.replace(pattern, (_, indent) => `${indent}const ${name} = ${scriptJson(value)};`);
}

// 先写同目录临时文件再改名：中途失败不会留下半截页面。
async function writeAtomic(file, text) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    await writeFile(temp, text);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const USAGE = '用法: node scripts/build-dashboard.mjs <库目录> [--out <输出文件>]';

function parseArgs(args) {
  const [library, flag, out, ...rest] = args;
  if (!library || library.startsWith('--') || rest.length) return null;
  if (flag === undefined) return { library, out: path.join('site', 'index.html') };
  if (flag !== '--out' || !out || out.startsWith('--')) return null;
  return { library, out };
}

// --out 只接受库目录内的相对路径，防止把页面写到库外。
function outInsideLibrary(libraryDir, out) {
  if (path.isAbsolute(out)) return false;
  const relative = path.relative(libraryDir, path.resolve(libraryDir, out));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(USAGE);
    process.exit(2);
  }
  const libraryDir = path.resolve(parsed.library);
  if (!outInsideLibrary(libraryDir, parsed.out)) {
    console.error('失败: --out 必须在库目录内');
    process.exit(2);
  }
  if (!parsed.out.toLowerCase().endsWith('.html')) {
    console.error('失败: --out 必须是 .html 结尾的文件');
    process.exit(2);
  }

  assertPrivateIgnored(libraryDir);
  const passphrase = await resolvePassphrase({
    env: process.env,
    libraryDir,
    interactive: Boolean(process.stdin.isTTY)
  });
  const { overview, detail, warnings } = await buildDashboardData(libraryDir);
  for (const warning of warnings) console.error(`警告: ${warning}`);
  const detailText = JSON.stringify(detail);
  const payload = await encryptText(detailText, passphrase);
  if ((await decryptPayload(payload, passphrase)) !== detailText) {
    throw new Error('加密自检失败：解密结果与明细不一致');
  }

  let html = await readFile(TEMPLATE, 'utf8');
  html = inject(html, INJECTION.overview, 'DASHBOARD_OVERVIEW', overview);
  html = inject(html, INJECTION.encrypted, 'ENCRYPTED_DASHBOARD', payload);

  const out = path.resolve(libraryDir, parsed.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeAtomic(out, html);
  console.error(`加密自检通过，已写入 ${out}`);
}

main().catch((error) => {
  console.error(`失败: ${error.message}`);
  process.exit(1);
});
