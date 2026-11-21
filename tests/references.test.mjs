import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const REFERENCES = path.join(REPO, 'references');
const CHAPTERS = [
  '01-建库与日常维护.md',
  '02-成员档案.md',
  '03-保单台账与资料提取.md',
  '04-缺口矩阵.md',
  '05-配置原则.md',
  '06-核保策略.md',
  '07-慢病与核保受限人群.md',
  '08-少儿投保窗口.md',
  '09-投保人豁免.md',
  '10-定期与终身.md',
  '11-医疗险与重疾险.md',
  '12-等待期与犹豫期.md',
  '13-年度复盘与事件更新.md',
  '14-隐私分级与资料原件.md',
  '15-总览页与加密.md',
  '16-资料收集与问诊.md',
  '17-推荐方案输出.md',
  '18-常见问题.md',
  '19-理赔与报案.md'
];

// 指向 skill 内部的相对路径：以 scripts/ templates/ examples/ references/ dashboard/ 开头。
// 前面不能紧跟路径字符，避免把库内路径（如 site/、.private/ 下的同名目录）误认成 skill 路径。
const SKILL_PATH = /(?<![\w./-])(?:scripts|templates|examples|references|dashboard)\/[^\s`'"()<>\[\]，。、；：！？]*/g;

async function exists(rel) {
  try {
    await stat(path.join(REPO, rel));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// 真实产品常见的「名称 + 期号」写法（如「某某 8 号」）；监管令的「YYYY 年第 N 号」文号先剔除再查。
const PRODUCT_NUMBER = /[\u4e00-\u9fa5]{2,8}\s?\d{1,2}\s?号/g;
const DECREE_NUMBER = /\d{4}\s?年第\s?\d{1,3}\s?号/g;

export function productNameHits(markdown) {
  return [...markdown.replace(DECREE_NUMBER, '').matchAll(PRODUCT_NUMBER)].map((m) => m[0]);
}

export function skillPaths(markdown) {
  return [...markdown.matchAll(SKILL_PATH)].map((m) => m[0].replace(/[.,:;]+$/, ''));
}

test('方法论章节齐全', async () => {
  const files = await readdir(REFERENCES);
  for (const chapter of CHAPTERS) assert.ok(files.includes(chapter), `缺少 references/${chapter}`);
});

test('references 引用的 skill 内相对路径都存在', async () => {
  const files = (await readdir(REFERENCES)).filter((name) => name.endsWith('.md'));
  const missing = [];
  let checked = 0;
  for (const name of files) {
    const text = await readFile(path.join(REFERENCES, name), 'utf8');
    for (const rel of new Set(skillPaths(text))) {
      checked += 1;
      if (!(await exists(rel))) missing.push(`${name}: ${rel}`);
    }
  }
  assert.ok(checked > 0, '没有检查到任何路径');
  assert.deepEqual(missing, []);
});

test('references 不写绝对路径', async () => {
  const files = (await readdir(REFERENCES)).filter((name) => name.endsWith('.md'));
  for (const name of files) {
    const text = await readFile(path.join(REFERENCES, name), 'utf8');
    assert.doesNotMatch(text, /(?:\/home\/|\/Users\/|~\/|[A-Z]:\\)/, `${name} 含绝对路径`);
  }
});

test('章节互相引用写相对路径，不只写章名', async () => {
  const files = (await readdir(REFERENCES)).filter((name) => name.endsWith('.md'));
  for (const name of files) {
    const text = await readFile(path.join(REFERENCES, name), 'utf8');
    assert.doesNotMatch(text, /\d{2} 章《/, `${name} 只写了章名，改成 references/NN-章名.md`);
  }
});

test('references 不点名真实产品', async () => {
  // 示例产品一律用「示例」前缀加字母；真实产品常见的「名称 + 期号」写法（如「某某 8 号」）不得出现。
  const files = (await readdir(REFERENCES)).filter((name) => name.endsWith('.md'));
  for (const name of files) {
    const text = await readFile(path.join(REFERENCES, name), 'utf8');
    assert.deepEqual(productNameHits(text), [], `${name} 疑似点名产品`);
  }
});

test('产品名检查：放过监管令文号，仍拦产品期号', () => {
  assert.deepEqual(productNameHits('《健康保险管理办法》（中国银保监会令 2019 年第 3 号）第十五条'), []);
  assert.deepEqual(productNameHits('（银保监会令2022年第8号）'), []);
  assert.deepEqual(productNameHits('买示例宝 3 号'), ['买示例宝 3 号']);
  assert.deepEqual(productNameHits('示例宝3号'), ['示例宝3号']);
});

test('路径提取：识别 skill 路径，忽略库内路径', () => {
  assert.deepEqual(skillPaths('运行 `node scripts/build-dashboard.mjs <库目录>`。'), ['scripts/build-dashboard.mjs']);
  assert.deepEqual(skillPaths('见 `examples/demo-family/members/self.md`，'), ['examples/demo-family/members/self.md']);
  assert.deepEqual(skillPaths('原件放 `.private/policies/self/a.pdf` 与 `site/index.html`'), []);
});
