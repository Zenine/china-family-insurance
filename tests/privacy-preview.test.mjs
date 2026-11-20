import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { scanText } from '../scripts/privacy-scan.mjs';
import { startPreview } from '../scripts/preview.mjs';

const rules = (text, bl = []) => scanText(text, bl).map((h) => h.rule);

test('scanText: 18 位身份证样式（含末位 X）', () => {
  assert.equal(scanText('证 110101199003071234 号', []).length, 1);
  assert.equal(scanText('证 11010119900307123X', []).length, 1);
  assert.equal(scanText('证 11010119900307123', []).length, 0);
});

test('scanText: 手机号，不匹配更长数字串与座机/400', () => {
  assert.equal(scanText('电话 13812345678', []).length, 1);
  assert.equal(scanText('电话 400-000-0001', []).length, 0);
  assert.equal(scanText('单号 913812345678', []).length, 0);
  assert.equal(scanText('单号 138123456789', []).length, 0);
  assert.equal(scanText('电话 23812345678', []).length, 0);
});

test('scanText: 保单号后同行 8 位以上数字', () => {
  assert.equal(rules('保单号：12345678').length, 1);
  assert.equal(rules('保单号（脱敏）: 1234567890').length, 1);
  assert.equal(rules('保单号：1234567').length, 0);
  assert.equal(rules('保单号：末 4 位 0001').length, 0);
  assert.equal(rules('保单号：\n12345678').length, 0);
  assert.equal(rules('保单号：末 4 位 12345678').length, 1);
  assert.equal(rules('保单号：A1 12345678').length, 1);
  assert.equal(rules('保单号（脱敏）：末 4 位 6888').length, 0);
});

test('scanText: 黑名单按字面子串，忽略空行', () => {
  const hits = scanText('张三的保单', ['张三', '', '  ']);
  assert.deepEqual(hits.map((h) => h.match), ['张三']);
  assert.equal(scanText('无关', ['张三']).length, 0);
});

test('CLI: 命中退出码 1，干净目录 0，跳过 .git 与二进制，支持黑名单与注释', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scan-'));
  try {
    const run = (...a) => spawnSync('node', ['scripts/privacy-scan.mjs', ...a], { encoding: 'utf8' });
    await writeFile(path.join(dir, 'ok.md'), '干净内容');
    await mkdir(path.join(dir, '.git'));
    await writeFile(path.join(dir, '.git', 'x'), '13812345678');
    await writeFile(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, ...Buffer.from('13812345678')]));
    assert.equal(run(dir).status, 0);
    await writeFile(path.join(dir, 'bad.md'), '手机 13812345678');
    const r = run(dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /bad\.md: .+: 13812345678/);
    await rm(path.join(dir, 'bad.md'));
    const bl = path.join(dir, 'bl.txt');
    await writeFile(bl, '# 注释\n秘密词\n');
    await writeFile(path.join(dir, 'c.md'), '含 秘密词');
    assert.equal(run(dir, '--blacklist', bl).status, 1);
    assert.equal(run(dir).status, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('CLI: 目录不存在时输出失败信息并退出 2', () => {
  const r = spawnSync('node', ['scripts/privacy-scan.mjs', '/nonexistent-scan-dir-xyz'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^失败: /);
});

test('fixture 与模板、dashboard 零命中', () => {
  const r = spawnSync('node', ['scripts/privacy-scan.mjs', 'tests/fixtures', 'templates', 'dashboard'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
});

const get = (port, p) =>
  new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });

test('preview: 仅绑定 127.0.0.1，提供 site/ 静态文件并拒绝路径穿越', async () => {
  const lib = await mkdtemp(path.join(tmpdir(), 'prev-'));
  await mkdir(path.join(lib, 'site'));
  await writeFile(path.join(lib, 'site', 'index.html'), '<h1>hi</h1>');
  await writeFile(path.join(lib, 'secret.txt'), 'secret');
  const server = await startPreview({ root: path.join(lib, 'site'), port: 0 });
  try {
    const { address, port } = server.address();
    assert.equal(address, '127.0.0.1');
    const idx = await get(port, '/');
    assert.equal(idx.status, 200);
    assert.match(idx.body, /hi/);
    assert.equal((await get(port, '/nope.html')).status, 404);
    assert.equal((await get(port, '/../secret.txt')).status, 403);
    assert.equal((await get(port, '/%2e%2e/secret.txt')).status, 403);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(lib, { recursive: true, force: true });
  }
});

const PREVIEW = fileURLToPath(new URL('../scripts/preview.mjs', import.meta.url));

test('preview: --port 不是 1–65535 的整数时退出码 2', () => {
  for (const port of ['abc', '0', '65536', '80.5', '']) {
    const result = spawnSync(process.execPath, [PREVIEW, '.', '--port', port], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 2, `--port ${port}`);
    assert.match(result.stderr, /端口/);
  }
});

test('preview: 端口被占用时给出可读的提示', async () => {
  const lib = await mkdtemp(path.join(tmpdir(), 'prev-'));
  await mkdir(path.join(lib, 'site'));
  const blocker = http.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  try {
    const { port } = blocker.address();
    const result = spawnSync(process.execPath, [PREVIEW, lib, '--port', String(port)], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`端口 ${port} 已被占用`));
  } finally {
    await new Promise((r) => blocker.close(r));
    await rm(lib, { recursive: true, force: true });
  }
});

test('preview: 不跟随指向 site/ 外的符号链接', async () => {
  const lib = await mkdtemp(path.join(tmpdir(), 'prev-'));
  await mkdir(path.join(lib, 'site'));
  await writeFile(path.join(lib, 'secret.txt'), 'secret');
  await writeFile(path.join(lib, 'site', 'ok.txt'), 'ok');
  await symlink(path.join(lib, 'secret.txt'), path.join(lib, 'site', 'leak.txt'));
  await symlink(path.join(lib, 'site', 'ok.txt'), path.join(lib, 'site', 'inner.txt'));
  const server = await startPreview({ root: path.join(lib, 'site'), port: 0 });
  try {
    const { port } = server.address();
    const leak = await get(port, '/leak.txt');
    assert.equal(leak.status, 403);
    assert.doesNotMatch(leak.body, /secret/);
    assert.equal((await get(port, '/inner.txt')).body, 'ok');
  } finally {
    await new Promise((r) => server.close(r));
    await rm(lib, { recursive: true, force: true });
  }
});
