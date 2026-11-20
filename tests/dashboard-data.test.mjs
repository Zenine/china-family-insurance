import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFields, parseGapMatrix } from '../scripts/lib/ledger.mjs';
import { buildDashboardData } from '../scripts/lib/dashboard-data.mjs';

const LIBRARY = fileURLToPath(new URL('./fixtures/mini-library', import.meta.url));
const COVERAGE_VALUES = ['充分', '一般', '不足', '缺资料', '不适用'];
const KINDS = ['寿险', '重疾', '医疗', '意外', '年金'];

test('parseFields 认全角与半角冒号，空值与待补原样保留', () => {
  const fields = parseFields([
    '# 标题',
    '- 保险公司：示例保险甲',
    '- 产品全称: 示例医疗 A',
    '- 保障期限：',
    '- 续保或调整建议：待补',
    '- 覆盖充分 / 一般 / 不足：一般',
    '普通段落：不算字段'
  ].join('\n'));
  assert.equal(fields['保险公司'], '示例保险甲');
  assert.equal(fields['产品全称'], '示例医疗 A');
  assert.equal(fields['保障期限'], '');
  assert.equal(fields['续保或调整建议'], '待补');
  assert.equal(fields['覆盖充分 / 一般 / 不足'], '一般');
  assert.equal('普通段落' in fields, false);
});

test('parseFields 去掉字段名里的 ** 加粗', () => {
  const fields = parseFields('- **客服电话**：95500\n- **年保费：** 300 元\n');
  assert.equal(fields['客服电话'], '95500');
  assert.equal(fields['年保费'], '300 元');
});

test('parseGapMatrix 认不出的档位按缺资料，并记一条警告', () => {
  const warnings = [];
  const rows = parseGapMatrix([
    '| 成员 | 寿险 | 重疾 | 医疗 | 意外 | 年金 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| self | 够了 | 充分 |  | 充分 | 不适用 |'
  ].join('\n'), warnings);
  assert.deepEqual(rows[0], { member: 'self', 寿险: '缺资料', 重疾: '充分', 医疗: '缺资料', 意外: '充分', 年金: '不适用' });
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /self.*寿险.*够了/);
  assert.match(warnings[1], /self.*医疗/);
});

test('parseGapMatrix 取成员代号与五险种档位', () => {
  const rows = parseGapMatrix([
    '| 成员（年龄） | 寿险 | 重疾 | 医疗 | 意外 | 年金/教育金 |',
    '| --- | --- | --- | --- | --- | --- |',
    '| self 本人（47） | **不足** | 核保受限 | 一般（备注） | 充分 | 缺资料 |'
  ].join('\n'));
  assert.deepEqual(rows, [
    { member: 'self', 寿险: '不足', 重疾: '核保受限', 医疗: '一般', 意外: '充分', 年金: '缺资料' }
  ]);
});

test('detail 字段齐全，缺失字段为待补', async () => {
  const { detail } = await buildDashboardData(LIBRARY, { today: '2026-01-02' });
  const self = detail.members.find((m) => m.id === 'self');
  assert.equal(self.name, '本人');
  assert.equal(self.role, '主要收入来源');
  const accident = self.policies.find((p) => p.name === '示例意外 B');
  assert.equal(accident.term, '待补');
  assert.deepEqual(accident.contacts, []);
  assert.equal(accident.note, '待补');
  assert.equal(accident.policyId, '待补');
  assert.equal(accident.status, '充分');
  assert.equal(accident.renewal, '待补');
  assert.equal(accident.sumInsured, '待补');
  const medical = self.policies.find((p) => p.name === '示例医疗 A');
  assert.deepEqual(medical, {
    name: '示例医疗 A',
    company: '示例保险甲',
    type: '医疗',
    code: 'medical-a',
    term: '1 年（可续保）',
    status: '一般',
    premium: '300 元',
    renewal: '2026-01-01 / 2027-01-01',
    sumInsured: '200 万',
    policyId: '末 4 位 0001',
    note: '每年到期前确认续保',
    contacts: [{ label: '客服电话：400-000-0001', href: 'tel:400-000-0001' }],
    links: [],
    documents: []
  });
  const spouse = detail.members.find((m) => m.id === 'spouse');
  assert.equal(spouse.note, '待补');
  assert.equal(spouse.policies.length, 1);
});

test('detail gaps 保留核保受限原档位', async () => {
  const { detail } = await buildDashboardData(LIBRARY, { today: '2026-01-02' });
  const self = detail.members.find((m) => m.id === 'self');
  assert.deepEqual(self.gaps, [
    { kind: '寿险', tier: '不足' },
    { kind: '重疾', tier: '核保受限' },
    { kind: '医疗', tier: '一般' },
    { kind: '意外', tier: '充分' },
    { kind: '年金', tier: '缺资料' }
  ]);
});

test('overview 只含称呼与档位，不出现核保受限、产品名与电话', async () => {
  const { overview, detail } = await buildDashboardData(LIBRARY, { today: '2026-01-02' });
  assert.equal(overview.generatedAt, '2026-01-02');
  const text = JSON.stringify(overview);
  assert.equal(text.includes('核保受限'), false);
  assert.equal(text.includes('见明细'), false);
  for (const member of detail.members) {
    for (const policy of member.policies) {
      for (const value of [policy.name, policy.company, policy.premium]) {
        assert.equal(text.includes(value), false, value);
      }
    }
  }
  assert.equal(/400-000-/.test(text), false);
  for (const member of overview.members) {
    assert.deepEqual(Object.keys(member).sort(), ['coverage', 'id', 'name']);
    assert.deepEqual(Object.keys(member.coverage).sort(), [...KINDS].sort());
    for (const value of Object.values(member.coverage)) assert.ok(COVERAGE_VALUES.includes(value), value);
  }
  assert.equal(overview.members.find((m) => m.id === 'self').coverage['重疾'], '不足');
});

test('policyId 不含超过 4 位的连续数字', async () => {
  const { detail } = await buildDashboardData(LIBRARY, { today: '2026-01-02' });
  for (const member of detail.members) {
    for (const policy of member.policies) assert.equal(/\d{5,}/.test(policy.policyId), false, policy.policyId);
  }
});

test('generatedAt 默认取当天日期', async () => {
  const { overview } = await buildDashboardData(LIBRARY);
  assert.match(overview.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
});

test('成员按约定顺序排列，其余按文件名，模板与无矩阵成员处理', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfi-order-'));
  try {
    await mkdir(path.join(dir, 'members'));
    for (const id of ['zeta', 'mother', 'aunt', 'son', 'self', 'father', 'daughter', 'spouse', '_template']) {
      await writeFile(path.join(dir, 'members', `${id}.md`), `- 代号 / 称呼：${id === 'aunt' ? '' : id}\n`);
    }
    const { overview, detail } = await buildDashboardData(dir, { today: '2026-01-02' });
    assert.deepEqual(
      overview.members.map((m) => m.id),
      ['self', 'spouse', 'daughter', 'son', 'father', 'mother', 'aunt', 'zeta']
    );
    assert.equal(overview.members.find((m) => m.id === 'aunt').name, 'aunt');
    assert.deepEqual(Object.values(overview.members[0].coverage), Array(5).fill('缺资料'));
    assert.deepEqual(detail.members[0].policies, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('成员备注去掉列表符号，多行合成一行', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfi-note-'));
  try {
    await mkdir(path.join(dir, 'members'));
    await writeFile(path.join(dir, 'members', 'self.md'), [
      '- 代号 / 称呼：本人',
      '',
      '## 备注',
      '',
      '- 家庭：两人，无子女',
      '* 资料来源：口述',
      '',
      '血压控制满 1 年后重新核保'
    ].join('\n'));
    const { detail } = await buildDashboardData(dir, { today: '2026-01-02' });
    assert.equal(detail.members[0].note, '家庭：两人，无子女；资料来源：口述；血压控制满 1 年后重新核保');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function withPolicy(policyMarkdown, matrix, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cfi-policy-'));
  try {
    await mkdir(path.join(dir, 'members'));
    await mkdir(path.join(dir, 'policies', 'self'), { recursive: true });
    await mkdir(path.join(dir, 'analysis'));
    await writeFile(path.join(dir, 'members', 'self.md'), '- 代号 / 称呼：本人\n');
    await writeFile(path.join(dir, 'policies', 'self', 'p.md'), policyMarkdown);
    await writeFile(path.join(dir, 'analysis', 'gap_matrix.md'), matrix);
    await fn(await buildDashboardData(dir, { today: '2026-01-02' }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const MATRIX_HEAD = '| 成员 | 寿险 | 重疾 | 医疗 | 意外 | 年金 |\n| --- | --- | --- | --- | --- | --- |\n';

test('多个客服电话时 href 只取第一个号码，显示保留原文', async () => {
  await withPolicy('- 客服电话：400-000-0001 / 95500（转 2）\n', `${MATRIX_HEAD}| self | 充分 | 充分 | 充分 | 充分 | 充分 |\n`, ({ detail, warnings }) => {
    assert.deepEqual(detail.members[0].policies[0].contacts, [
      { label: '客服电话：400-000-0001 / 95500（转 2）', href: 'tel:400-000-0001' }
    ]);
    assert.deepEqual(warnings, []);
  });
});

test('矩阵行对不上成员、档位认不出时给出警告', async () => {
  await withPolicy('- 产品全称：P\n', `${MATRIX_HEAD}| self | 充分 | 很好 | 充分 | 充分 | 充分 |\n| uncle | 充分 | 充分 | 充分 | 充分 | 充分 |\n`, ({ warnings }) => {
    assert.equal(warnings.length, 2);
    assert.match(warnings.join('\n'), /self.*重疾.*很好/);
    assert.match(warnings.join('\n'), /uncle/);
  });
});
