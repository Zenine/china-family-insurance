// 把家庭保险库整理成 dashboard 数据：明文 overview 与待加密的 detail。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { KINDS, parseDates, parseFields, parseGapMatrix } from './ledger.mjs';

const PENDING = '待补';
const MEMBER_ORDER = ['self', 'spouse', 'daughter', 'son', 'father', 'mother'];
const STATUS_FIELD = '覆盖充分 / 一般 / 不足';
const ROLE_FIELD_PREFIX = '家庭角色';
const RENEWAL_FIELD = '生效日 / 下次交费日';
const TODO_WINDOW_DAYS = 60;

// 「核保受限」间接披露健康状况，明文总览按「不足」显示，原档位只进加密明细。
function overviewTier(tier) {
  return tier === '核保受限' ? '不足' : tier;
}

function orValue(value) {
  return value && value.trim() ? value.trim() : PENDING;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 在 YYYY-MM-DD 上加天数，按 UTC 计算避免时区与夏令时偏移。
function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 宽限期按合同写天数，如「60 天」「30日」；认不出返回 null。
function graceDays(value) {
  const match = /(\d+)\s*[天日]/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

// 一份保单的台账日期：下次交费日（该行第二个日期）、保障到期日、宽限期止日。
function policyDates(fields) {
  const items = [];
  const nextPayment = parseDates(fields[RENEWAL_FIELD])[1];
  if (nextPayment) {
    items.push({ date: nextPayment, kind: '交费' });
    const days = graceDays(fields['宽限期']);
    if (days !== null) items.push({ date: addDays(nextPayment, days), kind: '宽限期止' });
  }
  const expiry = parseDates(fields['保障到期日'])[0];
  if (expiry) items.push({ date: expiry, kind: '到期' });
  return items;
}

async function listMarkdown(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('_'))
      .map((e) => e.name.slice(0, -3))
      .sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function orderMembers(ids) {
  const rank = (id) => {
    const index = MEMBER_ORDER.indexOf(id);
    return index === -1 ? MEMBER_ORDER.length : index;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

// 「## 备注」段落的正文。
function sectionText(markdown, title) {
  const match = new RegExp(`^##\\s*${title}\\s*$([\\s\\S]*?)(?=^#{1,2}\\s|(?![\\s\\S]))`, 'm').exec(markdown);
  return match ? match[1].trim() : '';
}

// 成员备注在页面上显示为一行：去掉列表符号，多行用「；」连接。
function memberNote(markdown) {
  return sectionText(markdown, '备注')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
    .join('；');
}

function maskPolicyId(value) {
  const match = /末\s*4\s*位\s*[：:]?\s*(?<!\d)(\d{4})(?!\d)/.exec(value ?? '');
  return match ? `末 4 位 ${match[1]}` : PENDING;
}

// 多个号码之间的分隔：、 / ／ ; ； , ， 或 转。
const PHONE_SEPARATOR = /[、\/／;；,，]|或|转/;

// 显示保留原文；href 只拨第一个含数字的号码：号码内可含空格、连字符与开头的 +，拨号时去掉空格与连字符。
function buildContacts(phone) {
  if (!phone || !phone.trim() || phone.trim() === PENDING) return [];
  const value = phone.trim();
  const first = value.split(PHONE_SEPARATOR).map((part) => /\+?\d[\d -]*\d|\d/.exec(part)).find(Boolean);
  const contact = { label: `客服电话：${value}` };
  if (first) contact.href = `tel:${first[0].replace(/[ -]/g, '')}`;
  return [contact];
}

function buildPolicy(code, fields) {
  return {
    name: orValue(fields['产品全称']),
    company: orValue(fields['保险公司']),
    type: orValue(fields['险种分类']),
    code,
    term: orValue(fields['保障期限']),
    status: orValue(fields[STATUS_FIELD]),
    premium: orValue(fields['年保费']),
    renewal: orValue(fields[RENEWAL_FIELD]),
    sumInsured: orValue(fields['主险保额']),
    policyId: maskPolicyId(fields['保单号（脱敏）']),
    note: orValue(fields['续保或调整建议']),
    contacts: buildContacts(fields['客服电话']),
    links: [],
    documents: [],
    expiry: orValue(fields['保障到期日']),
    grace: orValue(fields['宽限期']),
    claimDeadline: orValue(fields['报案时限']),
    claimDocs: orValue(fields['理赔材料（摘要）']),
    claimChannel: orValue(fields['理赔渠道']),
    deathBenefit: orValue(fields['身故保额'])
  };
}

export async function buildDashboardData(libraryDir, { today } = {}) {
  const generatedAt = typeof today === 'string' ? today : formatDate(today ?? new Date());
  const warnings = [];
  const matrix = new Map(
    parseGapMatrix(await readOptional(path.join(libraryDir, 'analysis', 'gap_matrix.md')), warnings).map((row) => [row.member, row])
  );
  const overviewMembers = [];
  const detailMembers = [];
  const todos = [];
  const windowEnd = addDays(generatedAt, TODO_WINDOW_DAYS);

  const memberIds = orderMembers(await listMarkdown(path.join(libraryDir, 'members')));
  for (const id of matrix.keys()) {
    if (!memberIds.includes(id)) warnings.push(`缺口矩阵行「${id}」对不上 members/ 里的任何成员，已忽略`);
  }

  for (const id of memberIds) {
    const markdown = await readFile(path.join(libraryDir, 'members', `${id}.md`), 'utf8');
    const fields = parseFields(markdown);
    const nameValue = orValue(fields['代号 / 称呼']);
    const name = nameValue === PENDING ? id : nameValue;
    const roleKey = Object.keys(fields).find((key) => key.startsWith(ROLE_FIELD_PREFIX));
    const row = matrix.get(id);
    const tiers = Object.fromEntries(KINDS.map((kind) => [kind, row?.[kind] ?? '缺资料']));

    const policyDir = path.join(libraryDir, 'policies', id);
    const policies = [];
    for (const code of await listMarkdown(policyDir)) {
      const policyFields = parseFields(await readFile(path.join(policyDir, `${code}.md`), 'utf8'));
      const policy = buildPolicy(code, policyFields);
      policies.push(policy);
      // 已过的日期一律列为逾期（不自动推算下一年），未来的只取 60 天内。
      for (const { date, kind } of policyDates(policyFields)) {
        if (date > windowEnd) continue;
        todos.push({ date, kind, member: name, policy: policy.name, overdue: date < generatedAt });
      }
    }

    overviewMembers.push({
      id,
      name,
      coverage: Object.fromEntries(KINDS.map((kind) => [kind, overviewTier(tiers[kind])]))
    });
    detailMembers.push({
      id,
      name,
      role: orValue(roleKey && fields[roleKey]),
      note: orValue(memberNote(markdown)),
      gaps: KINDS.map((kind) => ({ kind, tier: tiers[kind] })),
      policies
    });
  }

  return {
    overview: { generatedAt, members: overviewMembers },
    detail: { members: detailMembers, todos: todos.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) },
    warnings
  };
}
