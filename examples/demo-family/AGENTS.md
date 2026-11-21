# 库规则（本库必须为私有仓库或仅本地保存）

- skill: china-family-insurance
- version: 0.2.0

本库是一个家庭的保险资料库，由 skill `china-family-insurance` 建立和维护。内容是方法与工具产出的整理结果，不是持牌保险建议。

## 目录

- `members/<代号>.md`：成员档案，代号用英文（self / spouse / daughter / son / father / mother …）。
- `policies/<代号>/<险种>-<公司>-<年份>.md`：每份保单一个文件，字段按 `policies/_template.md`。
- `analysis/gap_matrix.md`：缺口矩阵，档位取 `充分 / 一般 / 不足 / 缺资料 / 不适用 / 核保受限`；`analysis/_review-template.md` 是年度检视模板。
- `recommendations/`：配置建议，按 `recommendations/_template.md` 写。
- `资料收集清单.md`：首次建档要准备的资料。
- `决策记录.md`：本人裁决，每条记日期、裁决、理由、影响的规则。
- `site/index.html`：总览页，由 build-dashboard 生成，不手改。

## 裁决优先级

- 库内已定裁决优先于 skill 默认规则。裁决来源：`决策记录.md`，以及 TODO / CHANGELOG / recommendations 中标明「本人裁决」的条目。
- 与 skill 默认规则冲突时，AI 指出一次差异，之后按裁决执行，不反复提醒。

## 隐私

- 证件、病历、体检报告、保单原件不贴进台账正文，台账只写文件名。
- 本库只存本机或私有仓库时，原件可以随库提交，放在 `policies/<代号>/`、`members/<代号>/`；本库可能公开、或会同步到网盘等其他地方时，原件只放 `.private/`。
- 台账里的保单号只写末 4 位，不写证件号与完整保单号。
- 总览页明文只含成员称呼与五险种档位；「核保受限」、产品、公司、日期、保费、电话、备注只进加密明细。

## 总览页口令

- 口令文件：`.private/dashboard-passphrase`，已被 git 忽略，权限设为 600。
- 读取顺序：环境变量 `DASHBOARD_PASSPHRASE` → `.private/dashboard-passphrase` → 交互输入。
- 口令文件的内容会进入 AI 会话；不愿让 AI 看到口令时，删掉该文件，改用环境变量或交互输入。

## 文档写法

- 只记事实与规则，不写过程自证与防御性声明。
- `CHANGELOG.md` 每条一行：`- YYYY-MM-DD 做了什么`。
- `TODO.md` 每条写做什么、为什么、下一步、验证；完成即删，完成事实记进 `CHANGELOG.md`。
- 推荐到险种与保额层；具体产品只在用户主动要求时当场联网查询，并标明查询日期与来源。
