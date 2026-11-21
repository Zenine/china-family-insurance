// 总览页隐私断言：明文总览 JSON、用户可见文字、模板静态部分分开检查。

import assert from 'node:assert/strict';

export const OVERVIEW_TIERS = ['充分', '一般', '不足', '缺资料', '不适用'];
export const HIDDEN_TERMS = ['核保受限', '见明细'];
const PHONE = /(?<!\d)(?:95\d{3}|400[\s-]?\d{3}[\s-]?\d{4})(?!\d)/;
const AMOUNT = /\d[\d,.]*\s*(?:元|万)/;

export function extractConst(html, name) {
  const match = new RegExp(`^\\s*const ${name} = (.*);$`, 'm').exec(html);
  assert.ok(match, `缺少注入行 ${name}`);
  return JSON.parse(match[1]);
}

// 去掉加密载荷后的页面：任何访问者都能读到的部分。
export function plaintextLayer(html) {
  return html.replace(/^\s*const ENCRYPTED_DASHBOARD = .*;$/m, '');
}

// 用户在页面上直接看到的文字：去掉 script、style、注释与标签。
export function visibleText(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// 明细里不得进明文的取值：产品名、公司、保费、保额、身故保额、电话原文。
export function detailSecrets(detail) {
  const values = detail.members.flatMap((member) => member.policies.flatMap((policy) => [
    policy.name, policy.company, policy.premium, policy.sumInsured, policy.deathBenefit,
    ...policy.contacts.map((contact) => contact.label.replace(/^客服电话：/, ''))
  ]));
  return [...new Set(values.filter((value) => value && value !== '待补'))];
}

export function assertOverviewPrivate(overview, secrets = []) {
  for (const member of overview.members) {
    for (const [kind, tier] of Object.entries(member.coverage)) {
      assert.ok(OVERVIEW_TIERS.includes(tier), `总览 ${member.id} ${kind} 档位不合法：${tier}`);
    }
  }
  const text = JSON.stringify(overview);
  for (const term of [...HIDDEN_TERMS, ...secrets]) assert.equal(text.includes(term), false, `总览含 ${term}`);
  assert.equal(PHONE.test(text), false, '总览含电话');
  assert.equal(AMOUNT.test(text), false, '总览含金额');
  assert.equal(/\d{5,}/.test(text), false, '总览含 5 位以上连续数字');
}

export function assertVisibleTextPrivate(html, secrets = []) {
  const text = visibleText(html);
  for (const term of [...HIDDEN_TERMS, ...secrets]) assert.equal(text.includes(term), false, `可见文字含 ${term}`);
  assert.equal(PHONE.test(text), false, '可见文字含电话');
}

// 静态模板只在档位配色表里出现一次「核保受限」，明细之外的地方都不出现。
export function assertTemplateTermOnce(text) {
  assert.equal(text.split('核保受限').length - 1, 1, '「核保受限」只能作为配色表的键出现一次');
  assert.match(text, /^\s*"核保受限": "warn",$/m);
  assert.equal(text.includes('见明细'), false);
}

// 构建产物的完整隐私检查。
export function assertPagePrivate(html, secrets) {
  assertOverviewPrivate(extractConst(html, 'DASHBOARD_OVERVIEW'), secrets);
  assertVisibleTextPrivate(html, secrets);
  const plain = plaintextLayer(html);
  assertTemplateTermOnce(plain);
  for (const secret of secrets) assert.equal(plain.includes(secret), false, `明文层含 ${secret}`);
  assert.equal(PHONE.test(plain), false, '明文层含电话');
}
