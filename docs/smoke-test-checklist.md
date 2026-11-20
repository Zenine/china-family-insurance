# 桌面工具手测清单

用于在 Trae、Qoder、CodeBuddy 等桌面 IDE 里手测本 skill 的核心流程。全程只用下面的虚构资料，不放真实家庭信息。

**准备**：装好 Node 20 或更高版本（`node -v`）；新建一个空文件夹，用桌面工具打开它作为项目。

| 步骤 | 操作 | 期望结果 |
| --- | --- | --- |
| 1. 安装 | 把本仓库整个目录改名为 `china-family-insurance`，放进项目的 skill 目录（Trae 为 `.trae/skills/`，其他工具见 `README.md` 的安装表）；或在项目目录运行 `npx skills add Zenine/china-family-insurance`。重开会话，问「你现在能用哪些 skill？」 | 回答里有 `china-family-insurance`；`<项目>/.trae/skills/china-family-insurance/SKILL.md` 存在 |
| 2. 建库 | 说「帮我建一个家庭保险库，家里有我和配偶，库放在当前项目下的 family-lib 子目录」 | 运行了 `node scripts/init-library.mjs <库目录绝对路径> --members self,spouse`，或把这条命令交给你运行；生成 `members/self.md`、`members/spouse.md`、`policies/`、`analysis/gap_matrix.md`、`TODO.md`、`CHANGELOG.md`、`.private/`、`.gitignore`；矩阵全是「缺资料」；结尾只问一个问题 |
| 3. 录入保单 | 粘贴：「录入两份保单（口述，无原件）：1. 我的定期寿险，产品全称示例定寿 B，示例人寿，客服电话 400-000-0001，保单号末 4 位 0101，保额 100 万，保至 60 岁，年交 1,200 元，交 20 年，生效日 2024-03-01。2. 配偶的百万医疗，产品全称示例百万医疗 C，示例健康，客服电话 400-000-0002，保单号末 4 位 0202，一般医疗 200 万，免赔额 1 万，1 年（保证续保 20 年），年保费 380 元，生效日 2025-07-01。」 | 新建 `policies/self/life-<公司拼音>-2024.md` 与 `policies/spouse/medical-<公司拼音>-2025.md`；字段行保留「产品全称」「保险公司」「年保费」「保单号（脱敏）」等原字段名；没说的字段写「待补」；保单号只有末 4 位；`TODO.md` 有补资料条目，`CHANGELOG.md` 每条一行 |
| 4. 出矩阵 | 说「出缺口矩阵，我们俩都有城镇职工医保，没有房贷，家庭年支出 15 万，没有孩子」 | 没确认有无其他保单的格子标「缺资料」，并问一次「除了已录入的，家里还有别的保单吗」；回答「没有了」后，两人的重疾、意外与本人的医疗（需要且没有保单）改为「不足」，寿险与年金按 `references/04-缺口矩阵.md` 可能是「一般」「不适用」或「缺资料」；`members/self.md`、`members/spouse.md` 的「备注」各加一行「已确认除已录入的保单外没有其他保单（日期）」；每格以档位词开头；有「关键缺口」一段 |
| 5. 生成总览页 | 说「生成总览页，口令用 test-accept-2026」 | 口令写进 `family-lib/.private/dashboard-passphrase`，没有出现在命令行、TODO、CHANGELOG 里；运行 `node scripts/build-dashboard.mjs <库目录>` 输出「加密自检通过」；生成 `family-lib/site/index.html`；提醒口令已进会话记录、这个口令偏弱 |
| 6. 解锁 | 双击 `site/index.html`（打不开时运行 `node scripts/preview.mjs <库目录>`，浏览器打开 `http://127.0.0.1:8787/`）；先输错口令，再输 `test-accept-2026` | 解锁前只看到「本人」「配偶」与五险种档位，看不到产品名、公司、电话；输错显示「口令不对，请重试」；输对后显示两份保单的产品、保障期限、年保费、末 4 位 |
| 7. 问具体产品 | 说「推荐一款具体的重疾险产品」 | 不凭记忆报产品名；能联网时当场查询并写明查询日期与来源，不能联网时给出检索方法与筛选清单；不出现购买链接或返佣信息 |

**收尾**：删除测试项目文件夹（含 `family-lib/.private/`）。
