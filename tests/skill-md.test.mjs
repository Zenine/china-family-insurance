import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// 与 tests/references.test.mjs 同一口径：指向 skill 内部的相对路径。
const SKILL_PATH = /(?<![\w./-])(?:scripts|templates|examples|references|dashboard)\/[^\s`'"()<>\[\]，。、；：！？]*/g;

function skillPaths(markdown) {
  return [...markdown.matchAll(SKILL_PATH)].map((m) => m[0].replace(/[.,:;]+$/, ''));
}

async function exists(rel) {
  try {
    await stat(path.join(REPO, rel));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function read(rel) {
  return readFile(path.join(REPO, rel), 'utf8');
}

async function referenceFiles() {
  const names = (await readdir(path.join(REPO, 'references'))).filter((name) => name.endsWith('.md'));
  return names.map((name) => `references/${name}`);
}

export function frontmatterKeys(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  return match[1]
    .split(/\r?\n/)
    .filter((line) => /^[A-Za-z_][\w-]*\s*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(':')).trim());
}

// markdown 链接 [文字](目标) 与图片 ![文字](目标) 中的相对目标；外链、锚点不算。
export function relativeLinks(markdown) {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1].split('#')[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

// 斜杠命令样式：行首、空白、反引号或括号后紧跟「/字母」，且不是路径的一段。
const SLASH_COMMAND = /(?:^|[\s`(（])\/[A-Za-z][\w:-]*(?![\w/.])/m;
const TOOL_CALL = /\b(?:Bash|Read|Write|Edit|Grep|Glob|WebFetch|WebSearch|Task|Skill)\(/;

test('SKILL.md frontmatter 只有 name 与 description', async () => {
  const text = await read('SKILL.md');
  const keys = frontmatterKeys(text);
  assert.ok(keys, 'SKILL.md 缺少 frontmatter');
  assert.deepEqual([...keys].sort(), ['description', 'name']);
  assert.match(text, /^name:\s*china-family-insurance\s*$/m);
});

test('SKILL.md 与 README 引用的仓库内相对路径都存在', async () => {
  const missing = [];
  for (const file of ['SKILL.md', 'README.md']) {
    const text = await read(file);
    const paths = new Set([...skillPaths(text), ...relativeLinks(text)]);
    assert.ok(paths.size > 0, `${file} 没有检查到任何路径`);
    for (const rel of paths) {
      if (!(await exists(rel))) missing.push(`${file}: ${rel}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('SKILL.md 按场景指向全部 18 章', async () => {
  const text = await read('SKILL.md');
  const linked = new Set(skillPaths(text).filter((p) => p.startsWith('references/')));
  for (const ref of await referenceFiles()) assert.ok(linked.has(ref), `SKILL.md 未指向 ${ref}`);
});

test('SKILL.md 与 references 不含斜杠命令与工具专属写法', async () => {
  for (const file of ['SKILL.md', ...(await referenceFiles())]) {
    const text = await read(file);
    assert.doesNotMatch(text, SLASH_COMMAND, `${file} 含斜杠命令样式`);
    assert.doesNotMatch(text, TOOL_CALL, `${file} 含工具专属写法`);
  }
});

test('检查器自测', () => {
  assert.deepEqual(frontmatterKeys('---\nname: a\ndescription: b\n---\n正文'), ['name', 'description']);
  assert.equal(frontmatterKeys('无 frontmatter'), null);
  assert.deepEqual(relativeLinks('[a](LICENSE) [b](https://x.cn/y) [c](#锚点) ![d](docs/x.png)'), ['LICENSE', 'docs/x.png']);
  assert.match('输入 /review 开始', SLASH_COMMAND);
  assert.match('`/skills`', SLASH_COMMAND);
  assert.doesNotMatch('打开 http://127.0.0.1:8787/', SLASH_COMMAND);
  assert.doesNotMatch('约 7 美元 / 用户 / 月', SLASH_COMMAND);
  assert.doesNotMatch('写进 `site/index.html` 与 `.private/dashboard-passphrase`', SLASH_COMMAND);
  assert.match('Bash(node x)', TOOL_CALL);
});

test('推荐模板含待补资料、已定裁决等栏目，五查模板五项齐全', async () => {
  const rec = await read('templates/recommendation.md');
  for (const heading of ['硬期限', '待补资料', '沿用的已定裁决', '待确认问题', '价格来源与查询日期']) {
    assert.match(rec, new RegExp(`^## ${heading}$`, 'm'), heading);
  }
  assert.ok(rec.includes('决策记录.md'));
  assert.ok(rec.includes('惠民保'));
  assert.ok(rec.includes('防癌医疗'));

  const check = await read('templates/new-policy-check.md');
  for (const heading of ['健康告知', '免责条款', '等待期', '续保条件', '理赔流程']) {
    const section = check.split(new RegExp(`^## .*${heading}.*$`, 'm'))[1];
    assert.ok(section !== undefined, `缺少 ${heading}`);
    const body = section.split(/^## /m)[0];
    for (const label of ['去合同哪里找', '要核对什么', '记到台账哪个字段']) {
      assert.ok(body.includes(label), `${heading} 缺少 ${label}`);
    }
  }
  // 引用的台账字段必须真实存在于 policy.md
  const policy = await read('templates/policy.md');
  const fields = [...check.matchAll(/记到台账哪个字段：(.+)/g)].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]));
  assert.ok(fields.length >= 5);
  for (const field of fields) assert.ok(policy.includes(`- ${field}：`), `policy.md 无字段 ${field}`);
});
