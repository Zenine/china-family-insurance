---
name: china-family-insurance
description: 中国大陆家庭保险库的建库、录入、分析与维护方法。用户上传体检报告、保单、家庭情况等资料想要保险配置建议，或想梳理全家保险、录入保单、做缺口分析、年度复盘、家里有事件后更新、生成加密总览页，或问医疗险重疾险怎么选、核保、等待期等常见问题时使用。推荐到险种与保额层，不内置产品清单。
---

# 中国家庭保险库

帮用户在自己电脑上的私有目录里建一个家庭保险库：成员档案、保单台账、缺口矩阵、推荐方案、待办、变更记录，以及一个口令加密的总览页。方法论在 `references/`，模板在 `templates/`，脚本在 `scripts/`。

## 先定位两个目录

- **本 skill 目录** = 本文件 SKILL.md 所在的目录。下文所有 `references/`、`templates/`、`scripts/`、`examples/` 路径都相对它。不知道这个目录在哪时，在文件系统里找名为 `china-family-insurance` 且含 SKILL.md 的目录，找不到就问用户。
- **用户的库目录** = 用户指定的私有目录，下文写作 `<库目录>`，传给脚本时用绝对路径。
- 所有脚本都在本 skill 目录下运行：先进入本 skill 目录，再执行 `node scripts/<脚本名>.mjs <库目录> …`。

## 按场景找章节

| 用户想做什么 | 先读 | 再做 |
| --- | --- | --- |
| 第一次用、还没有库 | `references/01-建库与日常维护.md` | 问清成员代号后运行 `node scripts/init-library.mjs <库目录> --members self,spouse,…` |
| 上传资料、要保险建议 | `references/16-资料收集与问诊.md` → `references/04-缺口矩阵.md` → 判断类章节（见下）→ `references/17-推荐方案输出.md` | 按 `templates/recommendation.md` 写 `<库目录>/recommendations/YYYY-MM-DD.md` 或 `YYYY-MM-DD-<主题>.md`，库里已有命名惯例的照惯例 |
| 录入保单（PDF、截图、口述） | `references/03-保单台账与资料提取.md`，成员信息见 `references/02-成员档案.md` | 每份保单一个台账文件，原件里没有的字段写「待补」 |
| 刚收到新保单、还在犹豫期内 | `templates/new-policy-check.md`（库里是 `新保单五查.md`）→ `references/20-投保后操作.md` 的「犹豫期内核对清单」 | 五项逐项核对，结果写进该保单台账；犹豫期最后一天写进 TODO |
| 用户拍板了一个取舍（不退保、不加豁免、某项不告知等） | `templates/decisions.md`（库里是 `决策记录.md`） | 当天在 `<库目录>/决策记录.md` 加一行：日期、裁决、理由、影响的规则 |
| 看缺口、打分 | `references/04-缺口矩阵.md` | 更新 `<库目录>/analysis/gap_matrix.md` |
| 年度复盘，或新投保、续保、体检、生娃、换工作等事件后更新 | `references/13-年度复盘与事件更新.md` | 按「台账 → 矩阵 → 待办 → 变更记录 → 总览页」顺序落地 |
| 家里有人出险，要报案、理赔或对结论有异议 | `references/19-理赔与报案.md` | 先查出险成员全部台账的报案时限与理赔字段，逐份报案；条款里找不到的写「未识别」 |
| 交费、宽限期、复效、改受益人、退保、犹豫期核对或家庭交接 | `references/20-投保后操作.md` | 先看台账的下次交费日与宽限期；退保前逐项写清现金价值与重新投保代价 |
| 生成或打开总览页 | `references/15-总览页与加密.md` | `node scripts/build-dashboard.mjs <库目录>`，打开不了时 `node scripts/preview.mjs <库目录>` |
| 问常见问题 | `references/18-常见问题.md` | 先一句结论，再结合这家人的档案和矩阵说怎么做 |
| 要具体产品 | `references/17-推荐方案输出.md` 的「用户要具体产品时」 | 当场联网查，写明查询日期与来源；不能联网就把检索方法和筛选清单交给用户 |
| 写入任何资料之前 | `references/14-隐私分级与资料原件.md` | 先判断这条信息属于哪一级 |

判断类章节，做推荐时按需读：

- `references/05-配置原则.md`：先保谁、预算不够砍什么。
- `references/06-核保策略.md`：健康有异常时怎么核保。
- `references/07-慢病与核保受限人群.md`：慢病、结节等买不到常规产品时的替代路径。
- `references/08-少儿投保窗口.md`：孩子什么时候投最合适。
- `references/09-投保人豁免.md`：什么时候值得加投保人豁免。
- `references/10-定期与终身.md`：保多久。
- `references/11-医疗险与重疾险.md`：两者管的钱不同，不能互相替代。
- `references/12-等待期与犹豫期.md`：起算日与换保顺序。

## 固定规则

- **推荐到险种与保额层**：每人补什么险种、保额、保障期、交费期、年预算区间、优先级、核保策略、挑选要点。默认不点名产品；用户主动要产品时才按 `references/17-推荐方案输出.md` 当场查。当前工具不能联网时，不凭记忆说产品名，按该章「不能联网时」把检索方法和筛选清单交给用户。
- **库内已定裁决优先**：动手前先读 `<库目录>/决策记录.md`，并检索 TODO、CHANGELOG、`recommendations/` 里标明「本人裁决」的条目；旧库 TODO 顶部「已定口径」里的条目同样算裁决。用户的裁决和本 skill 的默认规则冲突时，指出一次差异，之后按裁决执行，不反复提醒。
- **不编数**：资料里没有的写「待补」；缺的项一次只问一个问题。
- **读不了原件就直说**：保单 PDF 或图片打不开、看不清、当前工具读不了图时，告诉用户读不了，请用户粘贴文字或口述 `references/03-保单台账与资料提取.md` 列的字段，其余写「待补」，不猜。
- **缺口档位**只用六个：充分、一般、不足、缺资料、不适用、核保受限。缺资料和核保受限都不算不足；用户确认过「除了已录入的再没有别的保单」，没有的险种才打不足；确认后在 `<库目录>/members/<代号>.md` 的「备注」加一行「已确认除已录入的保单外没有其他保单（YYYY-MM-DD）」。
- **隐私**：库必须私有；证件号、完整保单号、病历原文不写进库正文；原件和口令放 `<库目录>/.private/`。
- **总览页**：明文只有成员称呼与五险种档位，其余进加密明细；默认本机打开，不替用户部署到外网。用户在对话里给口令时，先确认 `<库目录>/.private/` 被 git 忽略，再用写文件的方式（不经命令行）写进 `<库目录>/.private/dashboard-passphrase`，口令不写进 build-dashboard 命令；生成后提醒口令已进会话记录、弱口令要换。
- **每次改动收尾**：更新 `<库目录>/TODO.md` 与 `<库目录>/CHANGELOG.md`（每条一行），有总览页的重新生成。总览页只读成员档案、台账和矩阵：只改了推荐方案、没改这三样时不必重建。
- **定位**：这是方法与工具，不是持牌保险建议；不推荐购买渠道，不放返佣或导流链接。

## 无法运行脚本时

没装 Node（脚本需要 Node 20 或更高版本），或当前工具不能执行命令、不能进入本 skill 目录时：

- **请用户代跑**：把完整命令交给用户——先进入本 skill 目录，再运行对应的 `node scripts/<脚本名>.mjs <库目录> …` 命令（写出实际的脚本名、库目录与参数），请用户运行后把输出贴回来，再接着做。
- **总览页口令**：生成总览页时请用户自己在终端运行 `node scripts/build-dashboard.mjs <库目录>`，交互输入口令，口令不用发给你。
- **手工建库**：用户也跑不了时，照 `templates/` 里的模板直接写出库的骨架——`AGENTS.md`（来自 `templates/library-AGENTS.md`）、`members/<代号>.md`（`templates/member.md`）、`policies/_template.md`（`templates/policy.md`）、`analysis/gap_matrix.md`（`templates/gap_matrix.md`）、`analysis/_review-template.md`（`templates/review.md`）、`recommendations/_template.md`（`templates/recommendation.md`）、`资料收集清单.md`（`templates/intake-checklist.md`）、`新保单五查.md`（`templates/new-policy-check.md`）、`决策记录.md`（`templates/decisions.md`）、`TODO.md`、`CHANGELOG.md`，再建空的 `.private/` 目录，并在 `.gitignore` 里加一行 `.private/`。模板里的占位符要换成实际内容：`{{version}}` 换成 `scripts/lib/version.mjs` 里的版本号，`{{member}}` 换成成员代号，`{{rows}}` 换成每位成员一行、五格都是「缺资料」的矩阵行（如 `| self | 缺资料 | 缺资料 | 缺资料 | 缺资料 | 缺资料 |`），`{{date}}` 换成当天日期（YYYY-MM-DD）；写完检查文件里不再有 `{{`。
- 录入、矩阵、推荐、复盘本来就是写 markdown，照常进行；总览页等能运行 Node 时再生成。

## 示例

`examples/demo-family/` 是一个虚构的六口之家完整库，可对照它的成员档案、台账、矩阵和推荐方案写法。总览页演示口令 `demo-2026`。
