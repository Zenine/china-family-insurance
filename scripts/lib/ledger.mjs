// 台账 markdown 解析：`- 字段：值` 行与缺口矩阵表格。

export const KINDS = ['寿险', '重疾', '医疗', '意外', '年金'];
export const TIERS = ['充分', '一般', '不足', '缺资料', '不适用', '核保受限'];

const FIELD_LINE = /^\s*-\s+([^：:]+?)\s*[：:]\s*(.*?)\s*$/;

// 字段名可能带 ** 加粗：`- **客服电话**：…` 或 `- **年保费：** …`，后者的收尾 ** 落在值开头。
export function parseFields(markdown) {
  const fields = {};
  for (const line of markdown.split(/\r?\n/)) {
    const match = FIELD_LINE.exec(line);
    if (!match) continue;
    const key = match[1].replace(/\*\*/g, '').trim();
    const openBold = (match[1].match(/\*\*/g) ?? []).length % 2 === 1;
    const value = openBold ? match[2].replace(/^\*\*\s*/, '') : match[2];
    if (key && !(key in fields)) fields[key] = value;
  }
  return fields;
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

// 档位取单元格开头的档位词（去掉加粗），认不出时返回 null。
function parseTier(cell) {
  const text = cell.replace(/\*\*/g, '').trim();
  return TIERS.find((tier) => text.startsWith(tier)) ?? null;
}

// 认不出的档位按「缺资料」，并往 warnings 里记一条。
export function parseGapMatrix(markdown, warnings = []) {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|')) continue;
    const header = splitRow(lines[i]);
    if (!header[0].includes('成员')) continue;
    const columns = KINDS.map((kind) => header.findIndex((cell) => cell.includes(kind)));
    if (columns.includes(-1)) continue;
    const rows = [];
    for (let j = i + 2; j < lines.length && lines[j].trim().startsWith('|'); j += 1) {
      const cells = splitRow(lines[j]);
      const member = cells[0].replace(/\*\*/g, '').trim().split(/[\s（(]/)[0];
      if (!member) continue;
      const row = { member };
      KINDS.forEach((kind, k) => {
        const cell = (cells[columns[k]] ?? '').trim();
        const tier = parseTier(cell);
        if (!tier) warnings.push(`缺口矩阵 ${member} 的${kind}「${cell}」不是已知档位，按「缺资料」处理`);
        row[kind] = tier ?? '缺资料';
      });
      rows.push(row);
    }
    return rows;
  }
  return [];
}

// 文本中所有合法的 `YYYY-MM-DD`，按出现顺序；月日不成立的（如 2026-02-30）跳过。
export function parseDates(text) {
  const dates = [];
  for (const match of String(text ?? '').matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)) {
    const [, y, m, d] = match.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) dates.push(match[0]);
  }
  return dates;
}
