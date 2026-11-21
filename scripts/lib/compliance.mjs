// 合规自检：收益承诺用语、收益率数字与点名推荐句型的固定规则。

export const EXEMPT_OPEN = '<!-- 合规反例 -->';
export const EXEMPT_CLOSE = '<!-- /合规反例 -->';

// 收益承诺类固定短语。
const PROMISE_PHRASES = [
  '保证收益',
  '保证回报',
  '保本保息',
  '稳赚',
  '保本高收益',
  '高收益',
  '零风险',
  '无风险收益',
  '刚性兑付',
  '收益翻倍',
  '保底收益'
];

// 「年化」「收益率」后面隔 0–4 个非标点字符紧跟百分比，如「年化 3.5%」「年化收益 3.5%」「收益率可以达到 5%」。
const RATE_NUMBER = /(?:年化|收益率)[^\s\d，。；：、！？,.;:!?（）()]{0,4}\s*\d+(?:\.\d+)?\s*[%％]/g;

// 点名推荐句型：推荐动词后紧跟产品式名称。产品式名称只认三种写法——书名号括起的名称、
// 「名称 + 期号」（如「某某 3 号」）、「示例 + 字母」的虚构产品；「首选医疗险」这类险种词不算。
const RECOMMEND_VERB = '(?:推荐购买|推荐买|强烈推荐|首选|闭眼入|闭眼买|无脑入|必买|就买)';
const PRODUCT_NAME =
  '(?:《[^》\\n]{1,30}》|[\\u4e00-\\u9fa5A-Za-z]{1,12}?\\s?\\d{1,2}\\s?号|示例[\\u4e00-\\u9fa5]{0,8}\\s?[A-Z](?![A-Za-z]))';
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

// 返回命中列表，每条 { rule, text }。
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
