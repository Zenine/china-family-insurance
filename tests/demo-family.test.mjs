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
import { OVERVIEW_TIERS, assertPagePrivate, detailSecrets, extractConst } from './helpers/page-privacy.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const DEMO = path.join(REPO, 'examples', 'demo-family');
const BUILD = path.join(REPO, 'scripts', 'build-dashboard.mjs');
const SCAN = path.join(REPO, 'scripts', 'privacy-scan.mjs');
const PASSPHRASE = 'demo-2026';

// 测试可能在 git 钩子里运行，子进程不得继承 GIT_* 变量。
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  delete env.DASHBOARD_PASSPHRASE;
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
      env: cleanEnv({ DASHBOARD_PASSPHRASE: PASSPHRASE }),
      encoding: 'utf8',
      stdio: 'pipe'
    });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    const overview = extractConst(html, 'DASHBOARD_OVERVIEW');
    assert.equal(overview.members.length, 6);
    assert.deepEqual(overviewTiers(overview), new Set(OVERVIEW_TIERS));
    const secrets = detailSecrets((await buildDashboardData(library)).detail);
    assert.ok(secrets.some((value) => value.includes('示例人寿')));
    assertPagePrivate(html, secrets);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('示例家庭：已提交的 site/index.html 与台账一致，演示口令可解开', async () => {
  const html = await readFile(path.join(DEMO, 'site', 'index.html'), 'utf8');
  const { overview, detail } = await buildDashboardData(DEMO);
  assert.deepEqual(extractConst(html, 'DASHBOARD_OVERVIEW').members, overview.members);
  const payload = extractConst(html, 'ENCRYPTED_DASHBOARD');
  assert.deepEqual(JSON.parse(await decryptPayload(payload, PASSPHRASE)), detail);
  assertPagePrivate(html, detailSecrets(detail));
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
