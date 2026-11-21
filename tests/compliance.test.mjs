import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXEMPT_OPEN, EXEMPT_CLOSE, RULES, complianceHits } from '../scripts/lib/compliance.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'compliance');
const SCAN_DIRS = ['references', 'templates', 'examples'];
const SCAN_FILES = ['SKILL.md', 'README.md'];

// 只有这些文件可以放 <!-- 合规反例 --> 豁免块。
const EXEMPT_ALLOWLIST = new Set(['tests/fixtures/compliance/good.md']);

async function markdownFiles(dir) {
  const entries = await readdir(path.join(REPO, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(rel)));
    else if (entry.name.endsWith('.md')) files.push(rel);
  }
  return files;
}

test('references、templates、examples、SKILL.md、README.md 无收益承诺与点名推荐', async () => {
  const files = [...SCAN_FILES];
  for (const dir of SCAN_DIRS) files.push(...(await markdownFiles(dir)));
  assert.ok(files.length > 30, `只扫到 ${files.length} 个文件`);
  const found = [];
  for (const rel of files) {
    const text = await readFile(path.join(REPO, rel), 'utf8');
    for (const hit of complianceHits(text)) found.push(`${rel}: ${hit.rule}「${hit.text}」`);
  }
  assert.deepEqual(found, []);
});

test('反例样本每条规则都命中', async () => {
  const hits = complianceHits(await readFile(path.join(FIXTURES, 'bad.md'), 'utf8'));
  assert.deepEqual([...new Set(hits.map((h) => h.rule))].sort(), [...RULES].sort());
  const texts = hits.map((h) => h.text);
  for (const expected of [
    '保证收益',
    '稳赚',
    '保本高收益',
    '保本保息',
    '保证回报',
    '年化 3.5%',
    '收益率达 6%',
    '年化收益 3.5%',
    '收益率可以达到 5%',
    '首选示例宝 3 号',
    '推荐购买《示例安心终身寿险》',
    '必买示例医疗 B'
  ]) {
    assert.ok(texts.includes(expected), `没抓到「${expected}」`);
  }
});

test('豁免标记只出现在允许名单里的文件', async () => {
  const files = ['SKILL.md', 'README.md'];
  for (const dir of [...SCAN_DIRS, 'tests', 'scripts']) files.push(...(await markdownFiles(dir)));
  const offenders = [];
  for (const rel of files) {
    const text = await readFile(path.join(REPO, rel), 'utf8');
    const used = text.includes(EXEMPT_OPEN) || text.includes(EXEMPT_CLOSE);
    if (used && !EXEMPT_ALLOWLIST.has(rel.split(path.sep).join('/'))) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
  const good = await readFile(path.join(FIXTURES, 'good.md'), 'utf8');
  assert.ok(good.includes(EXEMPT_OPEN), 'good.md 应含豁免块样例');
});

test('正例样本零命中（含豁免块与正常章节写法）', async () => {
  assert.deepEqual(complianceHits(await readFile(path.join(FIXTURES, 'good.md'), 'utf8')), []);
});

test('豁免标记：成对才豁免，不成对报错', () => {
  assert.deepEqual(complianceHits(`前文\n${EXEMPT_OPEN}\n稳赚\n${EXEMPT_CLOSE}\n后文`), []);
  assert.equal(complianceHits(`${EXEMPT_OPEN}\n稳赚\n${EXEMPT_CLOSE}\n又稳赚`).length, 1);
  assert.throws(() => complianceHits(`${EXEMPT_OPEN}\n稳赚`), /没有对应的结束标记/);
  assert.throws(() => complianceHits(`稳赚\n${EXEMPT_CLOSE}`), /没有开始标记/);
});

test('点名推荐句型：险种词不算产品名', () => {
  assert.deepEqual(complianceHits('预算有限时首选医疗险，再补重疾。'), []);
  assert.deepEqual(complianceHits('不推荐购买渠道。重疾能买就买。'), []);
  assert.equal(complianceHits('首选示例宝 3 号').length, 1);
  assert.equal(complianceHits('强烈推荐：《某某终身寿》').length, 1);
});

test('收益率数字：中间隔 1–4 个字也能抓到，标点隔开的不算', () => {
  assert.equal(complianceHits('年化收益 3.5%').length, 1);
  assert.equal(complianceHits('收益率可以达到 5%').length, 1);
  assert.deepEqual(complianceHits('收益率受预定利率上限约束，新产品上限为 2.0%。'), []);
  assert.deepEqual(complianceHits('全家年保费常见在家庭税后年收入的 5%–10%。'), []);
});
