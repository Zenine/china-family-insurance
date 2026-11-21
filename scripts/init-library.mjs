#!/usr/bin/env node
// 用法: node scripts/init-library.mjs <库目录> [--members self,spouse,daughter]
// 建立家庭保险库骨架。已存在的文件一律不改，只列为跳过；
// 唯一例外：已有 .gitignore 缺 .private/ 时追加这一行。

import { appendFile, chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_VERSION } from './lib/version.mjs';

const TEMPLATES = fileURLToPath(new URL('../templates/', import.meta.url));
const DEFAULT_MEMBERS = ['self', 'spouse'];
const MEMBER_ID = /^[a-z][a-z0-9_-]*$/;
const PRIVATE_IGNORE = '.private/';
// 已能忽略 .private/ 下全部内容的写法：.private、.private/、.private/*、.private/**，可带开头的 /。
const PRIVATE_IGNORED = /^\/?\.private(\/(\*{1,2})?)?$/;
const USAGE = '用法: node scripts/init-library.mjs <库目录> [--members self,spouse,daughter]';

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseArgs(argv) {
  let target;
  let members = DEFAULT_MEMBERS;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--members') {
      members = (argv[i + 1] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
      i += 1;
    } else if (target === undefined && !argv[i].startsWith('--')) {
      target = argv[i];
    } else {
      throw new Error(USAGE);
    }
  }
  if (target === undefined || members.length === 0) throw new Error(USAGE);
  const invalid = members.filter((id) => !MEMBER_ID.test(id));
  if (invalid.length) throw new Error(`成员代号只能用小写英文字母开头的字母、数字、-、_：${invalid.join(', ')}`);
  return { target, members: [...new Set(members)] };
}

async function render(name, values) {
  const text = await readFile(path.join(TEMPLATES, name), 'utf8');
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in values ? values[key] : match));
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function initLibrary(targetDir, { members = DEFAULT_MEMBERS, today = new Date() } = {}) {
  const root = path.resolve(targetDir);
  const report = { created: [], skipped: [], appended: [] };
  const values = { version: SKILL_VERSION, date: formatDate(today) };

  async function ensureDir(rel, mode) {
    const full = path.join(root, rel);
    if (await exists(full)) {
      report.skipped.push(`${rel}/`);
      return;
    }
    await mkdir(full, { recursive: true });
    if (mode !== undefined) await chmod(full, mode);
    report.created.push(`${rel}/`);
  }

  async function ensureFile(rel, template, extra = {}) {
    const full = path.join(root, rel);
    if (await exists(full)) {
      report.skipped.push(rel);
      return;
    }
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, await render(template, { ...values, ...extra }), { flag: 'wx' });
    report.created.push(rel);
  }

  await mkdir(root, { recursive: true });
  await ensureFile('AGENTS.md', 'library-AGENTS.md');
  for (const member of members) {
    await ensureFile(`members/${member}.md`, 'member.md', { member });
    await ensureDir(`policies/${member}`);
  }
  await ensureFile('policies/_template.md', 'policy.md');
  const rows = members.map((member) => `| ${member} | 缺资料 | 缺资料 | 缺资料 | 缺资料 | 缺资料 |`).join('\n');
  await ensureFile('analysis/gap_matrix.md', 'gap_matrix.md', { rows });
  await ensureFile('analysis/_review-template.md', 'review.md');
  await ensureDir('recommendations');
  await ensureFile('recommendations/_template.md', 'recommendation.md');
  await ensureFile('资料收集清单.md', 'intake-checklist.md');
  await ensureFile('新保单五查.md', 'new-policy-check.md');
  await ensureFile('决策记录.md', 'decisions.md');
  await ensureFile('TODO.md', 'TODO.md');
  await ensureFile('CHANGELOG.md', 'CHANGELOG.md');
  await ensureDir('.private', 0o700);

  const gitignore = path.join(root, '.gitignore');
  if (!(await exists(gitignore))) {
    await writeFile(gitignore, `${PRIVATE_IGNORE}\n`, { flag: 'wx' });
    report.created.push('.gitignore');
  } else {
    const text = await readFile(gitignore, 'utf8');
    const ignored = text.split(/\r?\n/).some((line) => PRIVATE_IGNORED.test(line.trim()));
    if (ignored) {
      report.skipped.push('.gitignore');
    } else {
      await appendFile(gitignore, `${text === '' || text.endsWith('\n') ? '' : '\n'}${PRIVATE_IGNORE}\n`);
      report.appended.push(`.gitignore（追加 ${PRIVATE_IGNORE}）`);
    }
  }
  return { root, ...report };
}

async function main() {
  const { target, members } = parseArgs(process.argv.slice(2));
  const { root, created, skipped, appended } = await initLibrary(target, { members });
  const lines = [`库目录: ${root}`];
  const section = (title, items) => {
    if (items.length) lines.push(`${title}（${items.length}）:`, ...items.map((item) => `  ${item}`));
  };
  section('新建', created);
  section('追加', appended);
  section('跳过（已存在，未改动）', skipped);
  console.log(lines.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`失败: ${error.message}`);
    process.exit(error.message === USAGE ? 2 : 1);
  });
}
