# 更新记录

## v0.1.1 — 2026-11-20

- 总览页模板的档位配色表恢复「核保受限」字面键；隐私测试改为分别检查明文总览 JSON、页面可见文字与模板（「核保受限」只作为配色表的键出现一次）。
- 客服电话的拨号链接支持号码内空格、连字符与开头的 +，拨号时去掉空格与连字符；多个号码用「、」「／」「；」「，」「或」「转」分隔时只拨第一个。
- 明细表去掉单独的联系方式列，客服电话显示在产品名下方，长文本换行；示例家庭在 1280px 宽度下表格无横向滚动。

## v0.1.0 — 2026-11-20

- 首个公开版本：SKILL.md 入口（适配 Claude Code、Codex、Trae、Qoder、CodeBuddy、Kimi Code CLI）、18 章方法论（references/）、9 份模板（templates/）。
- 零依赖 Node 脚本：建库（init-library）、生成加密总览页（build-dashboard）、加密（encrypt）、本地预览（preview）、隐私扫描（privacy-scan）。
- 虚构示例家庭与在线演示页（examples/demo-family/，演示口令 demo-2026），GitHub Pages 工作流只发布演示页。
