// PBKDF2-SHA256 + AES-256-GCM，payload 与 WebCrypto 解密端兼容。
// ciphertext = GCM 密文 + 16 字节认证标签（base64）。

import { createCipheriv, createDecipheriv, pbkdf2 as pbkdf2Cb, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import readline from 'node:readline';

const pbkdf2 = promisify(pbkdf2Cb);

const ITERATIONS = 210000;
const TAG_LENGTH = 16;
const PROMPT = '家庭口令（输入不回显）: ';

export async function encryptText(plaintext, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await pbkdf2(passphrase, salt, ITERATIONS, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const sealed = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    kdf: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    cipher: 'AES-GCM',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ciphertext: sealed.toString('base64')
  };
}

export async function decryptPayload(payload, passphrase) {
  try {
    const key = await pbkdf2(passphrase, Buffer.from(payload.salt, 'base64'), payload.iterations, 32, 'sha256');
    const sealed = Buffer.from(payload.ciphertext, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(sealed.subarray(sealed.length - TAG_LENGTH));
    const body = sealed.subarray(0, sealed.length - TAG_LENGTH);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('口令错误或数据已损坏');
  }
}

function promptHidden() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const originalWrite = rl._writeToOutput;
    rl._writeToOutput = (chunk) => {
      if (chunk.includes('家庭口令')) rl.output.write(chunk);
    };
    rl.question(PROMPT, (answer) => {
      rl._writeToOutput = originalWrite;
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// 优先级：环境变量 DASHBOARD_PASSPHRASE → <libraryDir>/.private/dashboard-passphrase → 交互输入。
export async function resolvePassphrase({ env = process.env, libraryDir, interactive = false } = {}) {
  if (env.DASHBOARD_PASSPHRASE) return env.DASHBOARD_PASSPHRASE;
  if (libraryDir) {
    try {
      const fromFile = (await readFile(path.join(libraryDir, '.private', 'dashboard-passphrase'), 'utf8')).trim();
      if (fromFile) return fromFile;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (interactive) {
    const answer = await promptHidden();
    if (answer) return answer;
  }
  throw new Error('未提供家庭口令（三种来源见 references/15-总览页与加密.md）');
}
