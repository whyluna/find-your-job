# FindYourJob

macOS 本地求职投递记录与面试复盘应用。状态由事件时间线推导——一条投递是一个聚合对象（基本信息 + JD 快照 + 事件时间线 + 面试逐题记录 + 简历版本关联），看板/表格/日历/统计都只是它的视图。

面向广泛求职人群：首次启动选场景模板（校招全流程 / 社招精简 / 实习 / 空白），渠道、批次、轮次标签、事件类型全部字典可自定义。

## 核心特性

- **状态机驱动**：19 种内置事件 + 面试记录自动推导投递状态（网申→测评→笔试→群面→多轮面试→OC→意向书→offer→两方→三方→签约），乱序补录、删除回退、挂后复活均正确重算
- **结构化面试复盘**：每轮面试逐题记录（题目/回答/表现/复盘/知识点标签），面经知识库按标签聚合，≥3 次标红为高频考点，错题本收集所有"答得差"
- **多简历版本**：投递必须标注所用版本，统计页可看各版本到面试/到 OC 率
- **JD 快照**：粘贴原文永久保存（招聘链接会过期）
- **浏览器扩展剪藏**：Boss直聘/牛客/猎聘/实习僧适配 + 公司官网 JobPosting 结构化数据，一键剪藏为「已保存」（仅监听 127.0.0.1 + Bearer token）
- **提醒**：3 天内截止 + 7 天内面试的今日待办；截止 24h 内/面试前 2h 系统通知
- **日历**：月历三色（面试/截止/投递）
- **统计**：阶段漏斗、渠道/批次分布、近 8 周投递曲线、沉默投递（14 天无动静）、简历版本表现
- **offer 对比**：五维加权评分（权重可调）
- **邮件解析**（纯规则无 AI）：导入 .eml → 识别测评/笔试/面试/意向书/offer/感谢信 + 提取截止时间 + 匹配公司库 → 人工确认后写入时间线
- **数据主权**：全部数据本地 SQLite + 应用数据目录；JSON 全量导出/导入、CSV（飞书兼容）导入导出、PIN 应用锁

## 安装与使用

```bash
# 从源码构建（需要 Node 22+/pnpm/Rust）
pnpm install
pnpm tauri build          # 产物: src-tauri/target/release/bundle/macos/FindYourJob.app
```

或直接使用 `FindYourJob_0.1.0_aarch64.dmg`（Apple Silicon）。首次打开如遇 Gatekeeper：右键 → 打开。

**浏览器扩展**：`apps/extension` 下 `pnpm build`，Chrome/Edge 打开 `chrome://extensions` → 开发者模式 → 加载已解压的 `apps/extension/.output/chrome-mv3`；在应用 设置 → 浏览器扩展接入 开启并复制 Token 填入扩展。

## 开发

```bash
pnpm tauri dev            # 开发模式（热更新）
pnpm test                 # 前端单测（Vitest）
cargo test                # Rust 单测+集成（src-tauri 下，46 条）
scripts/backup.sh         # 数据目录快照备份（保留最近 20 份）
```

技术栈：Tauri 2 + React 19 + TypeScript + Rust + sqlx/SQLite + dnd-kit + recharts + WXT（扩展）。
领域核心（状态机/服务层）在 `src-tauri/crates/core`，与 UI 完全解耦，58 条 Rust 测试覆盖。

## 文档

- 设计文档：[docs/design.md](docs/design.md)
- 验收记录：[docs/acceptance/](docs/acceptance/)
