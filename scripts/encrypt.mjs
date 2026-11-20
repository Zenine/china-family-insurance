#!/usr/bin/env node
// 用法: node scripts/encrypt.mjs <json> [--out file] [--library <库目录>]
// 口令来源: DASHBOARD_PASSPHRASE → <库目录>/.private/dashboard-passphrase → 交互输入。
// 库目录由 --library 指定，默认当前工作目录。输入 JSON 含明文敏感数据，请放在 .private/ 下。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encryptText, decryptPayload, resolvePassphrase } from './lib/crypto.mjs';

async function main() {
  const args = process.argv.slice(2);
  let out = null;
  let library = process.cwd();
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      out = args[++i];
      if (!out) throw new Error('--out 需要文件路径');
    } else if (args[i] === '--library') {
      library = args[++i];
      if (!library) throw new Error('--library 需要库目录');
    } else positional.push(args[i]);
  }
  if (positional.length !== 1) {
    console.error('用法: node scripts/encrypt.mjs <json> [--out file] [--library <库目录>]');
    process.exit(2);
  }

  const plaintext = await readFile(path.resolve(positional[0]), 'utf8');
  JSON.parse(plaintext);
  const passphrase = await resolvePassphrase({
    env: process.env,
    libraryDir: path.resolve(library),
    interactive: Boolean(process.stdin.isTTY)
  });
  const payload = await encryptText(plaintext, passphrase);
  if ((await decryptPayload(payload, passphrase)) !== plaintext) {
    throw new Error('加密自检失败：解密结果与明文不一致');
  }

  const text = JSON.stringify(payload);
  if (out) {
    await writeFile(path.resolve(out), text + '\n');
    console.error('加密自检通过，payload 已写入 ' + out);
  } else {
    console.log(text);
  }
}

main().catch((error) => {
  console.error(`失败: ${error.message}`);
  process.exit(1);
});
