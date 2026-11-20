import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encryptText, decryptPayload, resolvePassphrase } from '../scripts/lib/crypto.mjs';

test('加密后可用同口令解密还原', async () => {
  const text = JSON.stringify({ members: [{ name: '甲', note: '中文 ✓' }] });
  const payload = await encryptText(text, 'pw-1');
  assert.equal(await decryptPayload(payload, 'pw-1'), text);
});

test('错口令解密失败且消息固定', async () => {
  const payload = await encryptText('x', 'right');
  await assert.rejects(decryptPayload(payload, 'wrong'), { message: '口令错误或数据已损坏' });
});

test('payload 字段集合与参数固定', async () => {
  const payload = await encryptText('x', 'pw');
  assert.deepEqual(
    Object.keys(payload).sort(),
    ['cipher', 'ciphertext', 'hash', 'iterations', 'iv', 'kdf', 'salt']
  );
  assert.equal(payload.iterations, 210000);
  assert.equal(payload.kdf, 'PBKDF2');
  assert.equal(payload.hash, 'SHA-256');
  assert.equal(payload.cipher, 'AES-GCM');
});

test('resolvePassphrase 按优先级取口令', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfi-'));
  try {
    await assert.rejects(
      resolvePassphrase({ env: {}, libraryDir: dir, interactive: false }),
      { message: '未提供家庭口令（三种来源见 references/15-总览页与加密.md）' }
    );
    await mkdir(path.join(dir, '.private'));
    await writeFile(path.join(dir, '.private', 'dashboard-passphrase'), '  from-file\n');
    assert.equal(
      await resolvePassphrase({ env: { DASHBOARD_PASSPHRASE: 'from-env' }, libraryDir: dir, interactive: false }),
      'from-env'
    );
    assert.equal(
      await resolvePassphrase({ env: { DASHBOARD_PASSPHRASE: '' }, libraryDir: dir, interactive: false }),
      'from-file'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
