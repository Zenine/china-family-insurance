import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptPayload } from '../scripts/lib/crypto.mjs';
import { buildDashboardData } from '../scripts/lib/dashboard-data.mjs';
import { KINDS, TIERS, parseGapMatrix } from '../scripts/lib/ledger.mjs';
import { OVERVIEW_TIERS, assertPagePrivate, detailSecrets, extractConst, plaintextLayer } from './helpers/page-privacy.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEMO = path.join(REPO, 'examples', 'demo-family');
const BUILD = path.join(REPO, 'scripts', 'build-dashboard.mjs');
const SCAN = path.join(REPO, 'scripts', 'privacy-scan.mjs');
const PASSPHRASE = 'demo-2026';
// 示例页用固定日期构建，「近 60 天待办」不随运行日期变化。
const TODAY = '2026-11-20';
const CLAIM_KEYS = ['expiry', 'grace', 'claimDeadline', 'claimDocs', 'claimChannel', 'deathBenefit'];

// 测试可能在 git 钩子里运行，子进程不得继承 GIT_* 变量。
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  delete env.DASHBOARD_PASSPHRASE;
  delete env.DASHBOARD_TODAY;
  return { ...env, ...extra };
}

function overviewTiers(overview) {
  return new Set(overview.members.flatMap((m) => KINDS.map((kind) => m.coverage[kind])));
}

test('示例家庭：缺口矩阵覆盖全部 6 种档位，六位成员齐全', async () => {
  const rows = parseGapMatrix(await readFile(path.join(DEMO, 'analysis', 'gap_matrix.md'), 'utf8'));
  assert.deepEqual(rows.map((r) => r.member), ['self', 'spouse', 'daughter', 'son', 'father', 'mother']);
  const used = new Set(rows.flatMap((r) => KINDS.map((kind) => r[kind])));
  for (const tier of TIERS) assert.ok(used.has(tier), `矩阵缺少档位 ${tier}`);
});

test('示例家庭：用演示口令构建成功，总览出现除核保受限外的全部档位', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'cfi-demo-'));
  const library = path.join(root, 'demo-family');
  try {
    await cp(DEMO, library, { recursive: true });
    const result = spawnSync(process.execPath, [BUILD, library], {
      env: cleanEnv({ DASHBOARD_PASSPHRASE: PASSPHRASE, DASHBOARD_TODAY: TODAY }),
      encoding: 'utf8',
      stdio: 'pipe'
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    const overview = extractConst(html, 'DASHBOARD_OVERVIEW');
    assert.equal(overview.members.length, 6);
    assert.deepEqual(overviewTiers(overview), new Set(OVERVIEW_TIERS));
    const secrets = detailSecrets((await buildDashboardData(library, { today: TODAY })).detail);
    assert.ok(secrets.some((value) => value.includes('示例人寿')));
    assertPagePrivate(html, secrets);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('示例家庭：已提交的 site/index.html 与台账一致，演示口令可解开', async () => {
  const html = await readFile(path.join(DEMO, 'site', 'index.html'), 'utf8');
  const { overview, detail } = await buildDashboardData(DEMO, { today: TODAY });
  assert.deepEqual(extractConst(html, 'DASHBOARD_OVERVIEW'), overview);
  const payload = extractConst(html, 'ENCRYPTED_DASHBOARD');
  assert.deepEqual(JSON.parse(await decryptPayload(payload, PASSPHRASE)), detail);
  assertPagePrivate(html, detailSecrets(detail));
});

test('示例家庭：近 60 天待办含交费、到期与逾期，日期只在加密明细里', async () => {
  const html = await readFile(path.join(DEMO, 'site', 'index.html'), 'utf8');
  const detail = JSON.parse(await decryptPayload(extractConst(html, 'ENCRYPTED_DASHBOARD'), PASSPHRASE));
  const kinds = new Set(detail.todos.map((todo) => todo.kind));
  for (const kind of ['交费', '到期', '宽限期止']) assert.ok(kinds.has(kind), `待办缺少 ${kind}`);
  assert.ok(detail.todos.some((todo) => todo.overdue), '待办应有逾期项');
  assert.ok(detail.todos.some((todo) => !todo.overdue), '待办应有未到期项');
  const plain = plaintextLayer(html);
  for (const todo of detail.todos) assert.equal(plain.includes(todo.date), false, `明文层含 ${todo.date}`);
  assert.equal(JSON.stringify(extractConst(html, 'DASHBOARD_OVERVIEW')).includes('todos'), false);
});

test('示例家庭：每份保单都填了到期、宽限期、理赔与身故保额', async () => {
  const { detail } = await buildDashboardData(DEMO, { today: TODAY });
  for (const member of detail.members) {
    for (const policy of member.policies) {
      for (const key of CLAIM_KEYS) assert.notEqual(policy[key], '待补', `${member.id}/${policy.code} ${key}`);
      assert.match(policy.deathBenefit, /^\d+(\.\d+)? 万元/, `${member.id}/${policy.code} 身故保额`);
    }
  }
});

test('示例家庭：矩阵做了未成年人身故保额合计核对，决策记录与推荐方案按新模板写', async () => {
  const matrix = await readFile(path.join(DEMO, 'analysis', 'gap_matrix.md'), 'utf8');
  assert.match(matrix, /## 未成年人身故保额合计核对/);
  assert.match(matrix, /哥哥[^\n]*上限 50 万/);
  assert.match(matrix, /妹妹[^\n]*上限 20 万/);
  const decisions = await readFile(path.join(DEMO, '决策记录.md'), 'utf8');
  assert.ok((decisions.match(/^\| \d{4}-\d{2}-\d{2} \|/gm) ?? []).length >= 3, '决策记录至少 3 条');
  const recommendation = await readFile(path.join(DEMO, 'recommendations', '2026-11-20.md'), 'utf8');
  for (const section of ['硬期限', '待补资料', '沿用的已定裁决', '待确认问题', '价格来源与查询日期']) {
    assert.match(recommendation, new RegExp(`^## ${section}$`, 'm'), `推荐方案缺少 ${section}`);
  }
});

test('examples/ 隐私扫描零命中', () => {
  const result = spawnSync(process.execPath, [SCAN, path.join(REPO, 'examples')], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('Pages 工作流只发布示例家庭的 site/ 目录', async () => {
  const workflow = await readFile(path.join(REPO, '.github', 'workflows', 'pages.yml'), 'utf8');
  for (const fragment of ['actions/upload-pages-artifact@', 'actions/deploy-pages@', 'path: examples/demo-family/site', 'pages: write', 'id-token: write', '- main']) {
    assert.ok(workflow.includes(fragment), `工作流缺少 ${fragment}`);
  }
  assert.equal((workflow.match(/^\s*path:/gm) ?? []).length, 1, '只能有一个发布路径');
});
