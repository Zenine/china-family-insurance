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

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-library', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/build-dashboard.mjs', import.meta.url));
const SENSITIVE = ['示例医疗 A', '示例意外 B', '示例重疾 C', '示例保险甲', '400-000-0001', '400-000-0003', '核保受限', '见明细'];

// 测试可能在 git 钩子里运行，子进程不得继承 GIT_* 变量。
function cleanEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  delete env.DASHBOARD_PASSPHRASE;
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

function extractConst(html, name) {
  const match = new RegExp(`^\\s*const ${name} = (.*);$`, 'm').exec(html);
  assert.ok(match, `缺少注入行 ${name}`);
  return JSON.parse(match[1]);
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

    for (const text of SENSITIVE) assert.equal(html.includes(text), false, `HTML 含敏感文本 ${text}`);
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

test('模板档位配色只有一张表：一般与核保受限同为 warn，且不出现核保受限字面', async () => {
  const template = await readFile(fileURLToPath(new URL('../dashboard/index.html', import.meta.url)), 'utf8');
  const match = /const TIER_CLASS = (\{[\s\S]*?\});/.exec(template);
  assert.ok(match, '模板缺少 TIER_CLASS');
  const tierClass = JSON.parse(match[1]);
  assert.equal(tierClass['一般'], 'warn');
  assert.equal(tierClass['核保受限'], 'warn');
  assert.equal(template.match(/TIER_CLASS = /g).length, 1);
  assert.equal(template.includes('核保受限'), false);
  assert.equal(template.includes('见明细'), false);
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
