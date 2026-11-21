import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardData } from '../scripts/lib/dashboard-data.mjs';
import { SKILL_VERSION } from '../scripts/lib/version.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/init-library.mjs', import.meta.url));

function runInit(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8', stdio: 'pipe' });
}

async function withTempDir(fn) {
  const root = await mkdtemp(path.join(tmpdir(), 'cfi-init-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// 递归收集文件的内容与 mtime。
async function snapshot(dir, base = dir, out = new Map()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await snapshot(full, base, out);
    } else {
      const info = await stat(full);
      out.set(path.relative(base, full), { content: await readFile(full, 'utf8'), mtimeMs: info.mtimeMs });
    }
  }
  return out;
}

test('空目录生成完整库结构', async () => {
  await withTempDir(async (root) => {
    const lib = path.join(root, 'lib');
    const result = runInit(lib);
    assert.equal(result.status, 0, result.stderr);

    for (const file of [
      'AGENTS.md', 'members/self.md', 'members/spouse.md', 'policies/_template.md',
      'analysis/gap_matrix.md', 'TODO.md', 'CHANGELOG.md', '.gitignore', '资料收集清单.md'
    ]) {
      assert.ok((await stat(path.join(lib, file))).isFile(), file);
    }
    for (const dir of ['recommendations', 'policies/self', 'policies/spouse', '.private']) {
      assert.ok((await stat(path.join(lib, dir))).isDirectory(), dir);
    }
    assert.equal((await stat(path.join(lib, '.private'))).mode & 0o777, 0o700);
    assert.match(await readFile(path.join(lib, '.gitignore'), 'utf8'), /^\.private\/$/m);

    const agents = await readFile(path.join(lib, 'AGENTS.md'), 'utf8');
    assert.match(agents.split('\n')[0], /本库必须为私有仓库或仅本地保存/);
    assert.ok(agents.includes('skill: china-family-insurance'));
    assert.ok(agents.split('\n').includes(`- version: ${SKILL_VERSION}`));
    assert.ok(agents.includes('.private/dashboard-passphrase'));
    assert.ok(!agents.includes('{{'));
    assert.equal(SKILL_VERSION, '0.2.0');
    assert.ok(agents.includes('库内已定裁决优先于 skill 默认规则'));
    assert.ok(agents.includes('指出一次差异'));
    assert.ok(agents.includes('决策记录.md'));

    const decisions = await readFile(path.join(lib, '决策记录.md'), 'utf8');
    assert.ok(decisions.split('\n').includes('| 日期 | 裁决 | 理由 | 影响的规则 |'));
    assert.ok(decisions.includes('库内已定裁决优先于 skill 默认规则'));
    assert.ok(!decisions.includes('{{'));

    assert.match(result.stdout, /AGENTS\.md/);
  });
});

test('--members 指定成员并生成对应档案、保单目录与矩阵行', async () => {
  await withTempDir(async (root) => {
    const lib = path.join(root, 'lib');
    const result = runInit(lib, '--members', 'self,spouse,daughter');
    assert.equal(result.status, 0, result.stderr);
    assert.ok((await stat(path.join(lib, 'members/daughter.md'))).isFile());
    assert.ok((await stat(path.join(lib, 'policies/daughter'))).isDirectory());

    const data = await buildDashboardData(lib, { today: '2026-11-20' });
    assert.deepEqual(data.overview.members.map((m) => m.id), ['self', 'spouse', 'daughter']);
    for (const member of data.overview.members) {
      assert.deepEqual(Object.values(member.coverage), ['缺资料', '缺资料', '缺资料', '缺资料', '缺资料']);
    }
  });
});

test('非法成员代号被拒绝', async () => {
  await withTempDir(async (root) => {
    const result = runInit(path.join(root, 'lib'), '--members', 'self,../x');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /成员代号/);
  });
});

test('再次运行不改动已有文件的内容与 mtime，并列出跳过项', async () => {
  await withTempDir(async (root) => {
    const lib = path.join(root, 'lib');
    assert.equal(runInit(lib).status, 0);
    await writeFile(path.join(lib, 'members/self.md'), '# 已填写\n- 代号 / 称呼：我\n');
    const past = new Date('2020-01-01T00:00:00Z');
    for (const file of (await snapshot(lib)).keys()) await utimes(path.join(lib, file), past, past);

    await writeFile(path.join(lib, '决策记录.md'), '| 日期 | 裁决 | 理由 | 影响的规则 |\n|---|---|---|---|\n| 2026-11-20 | 已填 | x | y |\n');
    await utimes(path.join(lib, '决策记录.md'), past, past);

    const before = await snapshot(lib);
    const result = runInit(lib);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await snapshot(lib), before);
    assert.match(result.stdout, /跳过/);
    assert.match(result.stdout, /members\/self\.md/);
    assert.match(result.stdout, /决策记录\.md/);
  });
});

test('已有 .gitignore 缺 .private/ 时追加一行，其余内容保留', async () => {
  await withTempDir(async (root) => {
    const lib = path.join(root, 'lib');
    await mkdir(lib);
    await writeFile(path.join(lib, '.gitignore'), 'node_modules/');
    const result = runInit(lib);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(lib, '.gitignore'), 'utf8'), 'node_modules/\n.private/\n');

    assert.equal(runInit(lib).status, 0);
    assert.equal(await readFile(path.join(lib, '.gitignore'), 'utf8'), 'node_modules/\n.private/\n');
  });
});

test('模板字段与台账解析器一致', async () => {
  const templates = fileURLToPath(new URL('../templates/', import.meta.url));
  const policy = await readFile(path.join(templates, 'policy.md'), 'utf8');
  for (const field of ['保单号（脱敏）', '保险公司', '客服电话', '产品全称', '险种分类', '保障期限', '年保费', '主险保额', '生效日 / 下次交费日', '保障到期日', '宽限期', '报案时限', '理赔材料（摘要）', '理赔渠道', '身故保额']) {
    assert.match(policy, new RegExp(`^- ${field.replace(/[()（）]/g, '\\$&')}：`, 'm'), field);
  }
  assert.match(policy, /^## 评估备注$/m);
  assert.match(policy, /^- 覆盖充分 \/ 一般 \/ 不足：/m);

  const member = await readFile(path.join(templates, 'member.md'), 'utf8');
  assert.match(member, /^- 代号 \/ 称呼：/m);
  assert.match(member, /^- 家庭角色/m);
  assert.match(member, /^## 备注$/m);
});

test('已有 .gitignore 用 .private/* 或 /.private/ 时视为已忽略，不追加', async () => {
  for (const line of ['.private/*', '/.private/', '/.private/*', '.private/**']) {
    await withTempDir(async (root) => {
      const lib = path.join(root, 'lib');
      await mkdir(lib);
      await writeFile(path.join(lib, '.gitignore'), `${line}\n`);
      const result = runInit(lib);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(lib, '.gitignore'), 'utf8'), `${line}\n`, line);
    });
  }
});
