import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decryptPayload } from '../scripts/lib/crypto.mjs';
import { buildDashboardData } from '../scripts/lib/dashboard-data.mjs';
import { assertPagePrivate, assertTemplateTermOnce, detailSecrets, extractConst, plaintextLayer } from './helpers/page-privacy.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-library', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/build-dashboard.mjs', import.meta.url));
const SENSITIVE = ['示例医疗 A', '示例意外 B', '示例重疾 C', '示例意外 D', '示例保险甲', '示例保险丁', '400-000-0001', '400-000-0003', '400-000-0004'];

// 测试可能在 git 钩子里运行，子进程不得继承 GIT_* 变量。
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  delete env.DASHBOARD_PASSPHRASE;
  delete env.DASHBOARD_TODAY;
  return { ...env, ...extra };
}

async function copyFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'cfi-build-'));
  const library = path.join(root, 'library');
  await cp(FIXTURE, library, { recursive: true });
  return { root, library };
}

function runBuild(library, env, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, library, ...extraArgs], { env: cleanEnv(env), encoding: 'utf8', stdio: 'pipe' });
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, env: cleanEnv(), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function bytes(base64) {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

// 与页面内解密同一套 WebCrypto 调用，确认浏览器端能解开构建产物。
async function webCryptoDecrypt(payload, passphrase) {
  const { subtle } = globalThis.crypto;
  const material = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: bytes(payload.salt), iterations: payload.iterations, hash: payload.hash },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const plain = await subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.ciphertext));
  return new TextDecoder().decode(plain);
}

test('构建写出总览页：明文总览 + 可解密明细，且不泄露敏感字段', async () => {
  const { root, library } = await copyFixture();
  try {
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');

    const overview = extractConst(html, 'DASHBOARD_OVERVIEW');
    assert.equal(overview.members.length, 2);
    assert.deepEqual(overview.members.map((m) => m.name), ['本人', '配偶']);
    assert.equal(overview.members[0].coverage.重疾, '不足');

    const { detail } = await buildDashboardData(library);
    const payload = extractConst(html, 'ENCRYPTED_DASHBOARD');
    assert.deepEqual(JSON.parse(await decryptPayload(payload, 'test-pass')), detail);
    assert.deepEqual(JSON.parse(await webCryptoDecrypt(payload, 'test-pass')), detail);

    const secrets = detailSecrets(detail);
    for (const text of SENSITIVE) assert.ok(secrets.includes(text), `明细应含 ${text}`);
    assertPagePrivate(html, secrets);
    assert.equal(html.includes('undefined'), false);
    assert.ok(html.includes('<title>家庭保险总览</title>'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('注入 JSON 中的 </ 被转义，不会提前闭合 script', async () => {
  const { root, library } = await copyFixture();
  try {
    const member = path.join(library, 'members', 'self.md');
    const text = await readFile(member, 'utf8');
    await writeFile(member, text.replace('- 代号 / 称呼：本人', '- 代号 / 称呼：本人</script><b>'));
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    assert.equal(html.match(/<\/script>/g).length, 1);
    assert.equal(extractConst(html, 'DASHBOARD_OVERVIEW').members[0].name, '本人</script><b>');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('无口令时失败退出且不写文件', async () => {
  const { root, library } = await copyFixture();
  try {
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: '' });
    assert.notEqual(result.status, 0);
    assert.equal(result.stderr.includes('DASHBOARD_TODAY'), false, '未设 DASHBOARD_TODAY 时不打印警告');
    assert.match(result.stderr, /失败: 未提供家庭口令（三种来源见 references\/15-总览页与加密\.md）/);
    assert.equal(existsSync(path.join(library, 'site', 'index.html')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('库在 git 仓库中且 .private/ 未被忽略时拒绝构建', async () => {
  const { root, library } = await copyFixture();
  try {
    git(library, 'init', '-q');
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.private\/ 未被 git 忽略/);
    assert.equal(existsSync(path.join(library, 'site', 'index.html')), false);

    await writeFile(path.join(library, '.gitignore'), '.private/\n');
    const ok = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(existsSync(path.join(library, 'site', 'index.html')), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--out 相对库目录写到指定位置，不动 site/index.html', async () => {
  const { root, library } = await copyFixture();
  try {
    const landing = path.join(library, 'site', 'index.html');
    await mkdir(path.dirname(landing), { recursive: true });
    await writeFile(landing, 'landing');
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' }, ['--out', 'site/insurance-dashboard/index.html']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(landing, 'utf8'), 'landing');
    const html = await readFile(path.join(library, 'site', 'insurance-dashboard', 'index.html'), 'utf8');
    const payload = extractConst(html, 'ENCRYPTED_DASHBOARD');
    const { detail } = await buildDashboardData(library);
    assert.deepEqual(JSON.parse(await decryptPayload(payload, 'test-pass')), detail);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('参数不合法时打印用法并退出码 2', async () => {
  const { root, library } = await copyFixture();
  try {
    for (const extra of [['--out'], ['--out', '--bogus'], ['--bogus', 'x'], ['extra']]) {
      const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' }, extra);
      assert.equal(result.status, 2, `参数 ${extra.join(' ')} 应退出码 2`);
      assert.match(result.stderr, /用法/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('--out 指向库目录外时拒绝并退出码 2，不写文件', async () => {
  const { root, library } = await copyFixture();
  try {
    const outside = path.join(root, 'outside.html');
    for (const out of [outside, '../outside.html', 'site/../../outside.html']) {
      const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' }, ['--out', out]);
      assert.equal(result.status, 2, `--out ${out} 应退出码 2`);
      assert.match(result.stderr, /失败: --out 必须在库目录内/);
    }
    assert.equal(existsSync(outside), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模板档位配色只有一张表：一般与核保受限同为 warn，核保受限只作为配色表的键出现一次', async () => {
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  const match = /const TIER_CLASS = (\{[\s\S]*?\});/.exec(template);
  assert.ok(match, '模板缺少 TIER_CLASS');
  const tierClass = JSON.parse(match[1]);
  assert.equal(tierClass['一般'], 'warn');
  assert.equal(tierClass['核保受限'], 'warn');
  assert.equal(template.match(/TIER_CLASS = /g).length, 1);
  assertTemplateTermOnce(template);
});

test('矩阵行对不上成员时构建照常完成，stderr 打印警告', async () => {
  const { root, library } = await copyFixture();
  try {
    const matrix = path.join(library, 'analysis', 'gap_matrix.md');
    await writeFile(matrix, `${await readFile(matrix, 'utf8')}| uncle 舅舅（50） | 充分 | 充分 | 充分 | 充分 | 充分 |\n`);
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /警告: .*uncle/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('v0.1 台账（无新字段）构建成功，新字段为待补', async () => {
  const { root, library } = await copyFixture();
  try {
    await rm(path.join(library, 'policies', 'spouse', 'accident-d.md'));
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    const detail = JSON.parse(await decryptPayload(extractConst(html, 'ENCRYPTED_DASHBOARD'), 'test-pass'));
    assert.ok(Array.isArray(detail.todos));
    for (const policy of detail.members.flatMap((m) => m.policies)) {
      for (const key of ['expiry', 'grace', 'claimDeadline', 'claimDocs', 'claimChannel', 'deathBenefit']) {
        assert.equal(policy[key], '待补', `${policy.code} ${key}`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('近 60 天待办只在加密明细里：总览与明文层不含待办日期', async () => {
  const { root, library } = await copyFixture();
  try {
    const policy = path.join(library, 'policies', 'spouse', 'accident-d.md');
    // 把日期改成相对构建当天的日子，保证待办落在窗口内且与生成日期不同。
    const now = new Date();
    const shift = (days) => {
      const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days));
      return d.toISOString().slice(0, 10);
    };
    const text = (await readFile(policy, 'utf8'))
      .replace('2027-01-14', shift(20))
      .replace('2026-01-15 / 2026-11-15', `${shift(-300)} / ${shift(-3)}`);
    await writeFile(policy, text);
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    const detail = JSON.parse(await decryptPayload(extractConst(html, 'ENCRYPTED_DASHBOARD'), 'test-pass'));
    const kinds = detail.todos.filter((todo) => todo.policy === '示例意外 D').map((todo) => todo.kind).sort();
    assert.deepEqual(kinds, ['交费', '到期', '宽限期止']);
    assert.equal(detail.todos.find((todo) => todo.kind === '交费').overdue, true);
    const plain = plaintextLayer(html);
    // 总览明文本来就写生成日期，与它相同的待办日期不算泄露。
    const { generatedAt } = extractConst(html, 'DASHBOARD_OVERVIEW');
    for (const todo of detail.todos) {
      if (todo.date === generatedAt) continue;
      assert.equal(plain.includes(todo.date), false, `明文层含 ${todo.date}`);
    }
    assertPagePrivate(html, detailSecrets(detail));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('模板在成员明细上方渲染近 60 天待办，逾期行带标记', async () => {
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  const locked = template.indexOf('data-locked-detail');
  const todos = template.indexOf('data-todos');
  const layout = template.indexOf('class="layout"');
  assert.ok(locked !== -1 && locked < todos && todos < layout, '待办区应在加密明细内、成员明细之上');
  assert.ok(template.includes('近 60 天待办'));
  assert.ok(template.includes('todo.overdue'));
  assert.ok(template.includes('逾期'));
});

test('模板明细表有续保日期与保额两列', async () => {
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  assert.ok(template.includes('policy.renewal'));
  assert.ok(template.includes('policy.sumInsured'));
});

test('--out 只接受 .html 结尾的路径', async () => {
  const { root, library } = await copyFixture();
  try {
    for (const out of ['site/index.htm', 'site/dashboard', 'AGENTS.md']) {
      const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' }, ['--out', out]);
      assert.equal(result.status, 2, `--out ${out} 应退出码 2`);
      assert.match(result.stderr, /\.html/);
    }
    assert.ok((await readFile(path.join(library, 'members', 'self.md'), 'utf8')).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('输出先写临时文件再改名：替换而非原地改写，目录里不留临时文件', async () => {
  const { root, library } = await copyFixture();
  try {
    const { link, readdir } = await import('node:fs/promises');
    const out = path.join(library, 'site', 'index.html');
    const other = path.join(root, 'other-link.html');
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, 'old');
    await link(out, other);
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(other, 'utf8'), 'old', '原地改写会连带改动硬链接的另一头');
    assert.match(await readFile(out, 'utf8'), /ENCRYPTED_DASHBOARD = \{/);
    assert.deepEqual(await readdir(path.join(library, 'site')), ['index.html']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('encrypt.mjs 用 --library 指定口令文件所在的库目录', async () => {
  const { root, library } = await copyFixture();
  try {
    await mkdir(path.join(library, '.private'), { recursive: true });
    await writeFile(path.join(library, '.private', 'dashboard-passphrase'), 'lib-pass\n');
    const input = path.join(library, '.private', 'in.json');
    await writeFile(input, '{"a":1}');
    const script = fileURLToPath(new URL('../scripts/encrypt.mjs', import.meta.url));
    const result = spawnSync(process.execPath, [script, input, '--library', library], { cwd: root, env: cleanEnv(), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await decryptPayload(JSON.parse(result.stdout), 'lib-pass'), '{"a":1}');

    const missing = spawnSync(process.execPath, [script, input, '--library'], { cwd: root, env: cleanEnv(), encoding: 'utf8' });
    assert.notEqual(missing.status, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DASHBOARD_TODAY 固定生成日期与待办基准日', async () => {
  const { root, library } = await copyFixture();
  try {
    const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass', DASHBOARD_TODAY: '2026-11-20' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /警告: 使用 DASHBOARD_TODAY=2026-11-20 固定日期，仅用于示例与测试/);
    const html = await readFile(path.join(library, 'site', 'index.html'), 'utf8');
    assert.equal(extractConst(html, 'DASHBOARD_OVERVIEW').generatedAt, '2026-11-20');
    const detail = JSON.parse(await decryptPayload(extractConst(html, 'ENCRYPTED_DASHBOARD'), 'test-pass'));
    assert.deepEqual(detail, (await buildDashboardData(library, { today: '2026-11-20' })).detail);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('DASHBOARD_TODAY 不是合法 YYYY-MM-DD 时退出码 2，不写文件', async () => {
  const { root, library } = await copyFixture();
  try {
    for (const value of ['20261120', '2026-02-30', '2026-11-20x', 'today']) {
      const result = runBuild(library, { DASHBOARD_PASSPHRASE: 'test-pass', DASHBOARD_TODAY: value });
      assert.equal(result.status, 2, `DASHBOARD_TODAY=${value} 应退出码 2`);
      assert.match(result.stderr, /DASHBOARD_TODAY/);
    }
    assert.equal(existsSync(path.join(library, 'site', 'index.html')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 在 vm 里跑模板脚本：document 换成什么都接受的空壳，只取渲染函数用。
async function loadTemplateFunctions() {
  const { runInNewContext } = await import('node:vm');
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(template)[1];
  const element = new Proxy(function () {}, {
    get: (target, key) => (key === 'hidden' ? true : key === Symbol.toPrimitive ? () => '' : element),
    set: () => true,
    apply: () => element
  });
  const context = { document: { querySelector: () => element, querySelectorAll: () => [], addEventListener: () => {} } };
  runInNewContext(script, context);
  return context;
}

test('明细表每份保单有可折叠的到期与理赔行，字段全部转义', async () => {
  const { renderPolicies } = await loadTemplateFunctions();
  const policy = {
    name: '示例医疗 A', company: '示例保险甲', type: '医疗', code: 'medical-a', term: '1 年', status: '充分',
    premium: '300 元', renewal: '2026-01-01 / 2027-01-01', sumInsured: '200 万', policyId: '末 4 位 0001', note: '续保',
    contacts: [], links: [], documents: [],
    expiry: '2026-12-31', grace: '60 天', claimDeadline: '10 日内', claimDocs: '发票<img src=x onerror=alert(1)>',
    claimChannel: '官方 App', deathBenefit: '0 万元'
  };
  const html = renderPolicies({ name: '本人', policies: [policy] });
  assert.equal((html.match(/<details/g) ?? []).length, 1);
  for (const label of ['保障到期日', '宽限期', '报案时限', '理赔材料（摘要）', '理赔渠道', '身故保额']) {
    assert.ok(html.includes(label), `缺少 ${label}`);
  }
  for (const value of ['2026-12-31', '60 天', '10 日内', '官方 App', '0 万元']) assert.ok(html.includes(value), `缺少 ${value}`);
  assert.ok(html.includes('发票&lt;img src=x onerror=alert(1)&gt;'));
  assert.equal(html.includes('<img'), false);
  const columns = (/<thead>[\s\S]*?<\/thead>/.exec(html)[0].match(/<th>/g) ?? []).length;
  assert.ok(html.includes(`colspan="${columns}"`), '折叠行应横跨整张表');
});

test('模板提供「在本设备记住口令」：勾选后存本地、打开时自动解锁、可一键清除、存储失败不报错', async () => {
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  assert.match(template, /data-remember/);
  assert.match(template, /在本设备记住口令/);
  assert.match(template, /data-forget/);
  assert.match(template, /function rememberStore\(/);
  // 所有本地存储读写都经过带 try/catch 的封装，沙箱或隐私模式下不抛错
  const direct = template.match(/(?<!window\.)localStorage\./g) || [];
  assert.deepEqual(direct, []);
  // 存储键按页面路径区分，同域多份总览页互不覆盖
  assert.match(template, /window\.location\.pathname/);
});
