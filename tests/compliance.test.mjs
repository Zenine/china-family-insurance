import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = path.join(REPO, 'tests', 'fixtures', 'compliance');
const SCAN_DIRS = ['references', 'templates', 'examples'];
const SCAN_FILES = ['SKILL.md', 'README.md'];

const EXEMPT_OPEN = '<!-- 合规反例 -->';
const EXEMPT_CLOSE = '<!-- /合规反例 -->';

// 收益承诺类固定短语。
const PROMISE_PHRASES = ['保证收益', '稳赚', '保本高收益', '高收益', '零风险', '无风险收益', '刚性兑付', '收益翻倍', '保底收益'];

// 「年化」「收益率」后面紧跟百分比数字，如「年化 3.5%」「收益率达 6%」。
const RATE_NUMBER = /(?:年化|收益率)\s*(?:为|是|达|约|高达|可达|超过)?\s*\d+(?:\.\d+)?\s*[%％]/g;

// 点名推荐句型：推荐动词后紧跟产品式名称。产品式名称只认三种写法——书名号括起的名称、
// 「名称 + 期号」（如「某某 3 号」）、「示例 + 字母」的虚构产品；「首选医疗险」这类险种词不算。
const RECOMMEND_VERB = '(?:推荐购买|推荐买|强烈推荐|首选|闭眼入|闭眼买|无脑入|必买|就买)';
const PRODUCT_NAME = '(?:《[^》\\n]{1,30}》|[\\u4e00-\\u9fa5A-Za-z]{1,12}?\\s?\\d{1,2}\\s?号|示例[\\u4e00-\\u9fa5]{0,8}\\s?[A-Z](?![A-Za-z]))';
const NAMED_RECOMMENDATION = new RegExp(`${RECOMMEND_VERB}[\\s：:]*${PRODUCT_NAME}`, 'g');

export const RULES = ['收益承诺用语', '收益率数字', '点名推荐句型'];

// 去掉 <!-- 合规反例 --> 与 <!-- /合规反例 --> 之间的内容；标记不成对时报错。
export function stripExempt(markdown) {
  let out = '';
  let rest = markdown;
  for (;;) {
    const open = rest.indexOf(EXEMPT_OPEN);
    const close = rest.indexOf(EXEMPT_CLOSE);
    if (open === -1) {
      if (close !== -1) throw new Error('合规反例结束标记前没有开始标记');
      return out + rest;
    }
    if (close !== -1 && close < open) throw new Error('合规反例结束标记前没有开始标记');
    const end = rest.indexOf(EXEMPT_CLOSE, open + EXEMPT_OPEN.length);
    if (end === -1) throw new Error('合规反例开始标记没有对应的结束标记');
    out += rest.slice(0, open);
    rest = rest.slice(end + EXEMPT_CLOSE.length);
  }
}

export function complianceHits(markdown) {
  const text = stripExempt(markdown);
  const hits = [];
  for (const phrase of PROMISE_PHRASES) {
    let from = text.indexOf(phrase);
    while (from !== -1) {
      hits.push({ rule: '收益承诺用语', text: phrase });
      from = text.indexOf(phrase, from + phrase.length);
    }
  }
  for (const m of text.matchAll(RATE_NUMBER)) hits.push({ rule: '收益率数字', text: m[0] });
  for (const m of text.matchAll(NAMED_RECOMMENDATION)) hits.push({ rule: '点名推荐句型', text: m[0] });
  return hits;
}

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
  for (const expected of ['保证收益', '稳赚', '保本高收益', '年化 3.5%', '收益率达 6%', '首选示例宝 3 号', '推荐购买《示例安心终身寿险》', '必买示例医疗 B']) {
    assert.ok(texts.includes(expected), `没抓到「${expected}」`);
  }
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
