// 把家庭保险库整理成 dashboard 数据：明文 overview 与待加密的 detail。

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { KINDS, parseFields, parseGapMatrix } from './ledger.mjs';

const PENDING = '待补';
const MEMBER_ORDER = ['self', 'spouse', 'daughter', 'son', 'father', 'mother'];
const STATUS_FIELD = '覆盖充分 / 一般 / 不足';
const ROLE_FIELD_PREFIX = '家庭角色';

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

// 显示保留原文；href 只取第一段连续的号码字符，多个号码时只拨第一个。
function buildContacts(phone) {
  if (!phone || !phone.trim() || phone.trim() === PENDING) return [];
  const value = phone.trim();
  const first = /\+?\d[\d-]*\d|\d/.exec(value);
  const contact = { label: `客服电话：${value}` };
  if (first) contact.href = `tel:${first[0]}`;
  return [contact];
}

function buildPolicy(code, markdown) {
  const fields = parseFields(markdown);
  return {
    name: orValue(fields['产品全称']),
    company: orValue(fields['保险公司']),
    type: orValue(fields['险种分类']),
    code,
    term: orValue(fields['保障期限']),
    status: orValue(fields[STATUS_FIELD]),
    premium: orValue(fields['年保费']),
    renewal: orValue(fields['生效日 / 下次交费日']),
    sumInsured: orValue(fields['主险保额']),
    policyId: maskPolicyId(fields['保单号（脱敏）']),
    note: orValue(fields['续保或调整建议']),
    contacts: buildContacts(fields['客服电话']),
    links: [],
    documents: []
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
      policies.push(buildPolicy(code, await readFile(path.join(policyDir, `${code}.md`), 'utf8')));
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
    detail: { members: detailMembers },
    warnings
  };
}
