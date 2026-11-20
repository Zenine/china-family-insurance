#!/usr/bin/env node
// 用法: node scripts/preview.mjs <libraryDir> [--port 8787]
// 只监听 127.0.0.1，静态提供 <libraryDir>/site/；符号链接指向 site/ 之外时拒绝。

import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function inside(base, target) {
  return target === base || target.startsWith(base + path.sep);
}

export async function startPreview({ root, port = 8787 }) {
  const base = await realpath(path.resolve(root));
  const server = http.createServer(async (req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    let rel;
    try {
      rel = decodeURIComponent(req.url.split(/[?#]/)[0]);
    } catch {
      return send(400, 'Bad Request');
    }
    if (rel.includes('\0')) return send(400, 'Bad Request');
    const raw = path.resolve(base, '.' + (rel.startsWith('/') ? rel : '/' + rel));
    if (!inside(base, raw)) return send(403, 'Forbidden');
    const file = rel.endsWith('/') ? path.join(raw, 'index.html') : raw;
    let real;
    try {
      real = await realpath(file);
    } catch {
      return send(404, 'Not Found');
    }
    if (!inside(base, real)) return send(403, 'Forbidden');
    try {
      const data = await readFile(real);
      send(200, data, TYPES[path.extname(file)] ?? 'application/octet-stream');
    } catch {
      send(404, 'Not Found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const USAGE = '用法: node scripts/preview.mjs <libraryDir> [--port 8787]';

function parsePort(value) {
  if (!/^\d+$/.test(value ?? '')) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

async function main() {
  const args = process.argv.slice(2);
  let port = 8787;
  let lib = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
      const value = args[++i];
      port = parsePort(value);
      if (port === null) {
        console.error(`失败: 端口必须是 1–65535 的整数，收到「${value ?? ''}」`);
        process.exit(2);
      }
    } else lib = args[i];
  }
  if (!lib) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const server = await startPreview({ root: path.join(lib, 'site'), port });
    console.log(`预览: http://127.0.0.1:${server.address().port}/`);
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.error(`失败: 端口 ${port} 已被占用，换一个端口，例如 --port ${port === 65535 ? 8788 : port + 1}`);
    } else if (error.code === 'ENOENT') {
      console.error(`失败: 找不到 ${path.join(lib, 'site')}，先生成总览页`);
    } else {
      console.error(`失败: ${error.message}`);
    }
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
