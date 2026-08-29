# FindYourJob — 求职投递记录与面试复盘系统 · 设计文档

> 版本 v1.2（macOS 原生应用形态，待用户评审）· 2026-08-29
> 定位：**macOS 桌面应用**，面向广泛求职群体（校招/社招/实习、各行业），以校招流程为最完整的预置模板、其他场景可精简定制。覆盖「投递记录 → 测评/笔试/面试过程 → 面经复盘 → offer 比较」全流程。数据本地优先。

---

## 1. 项目概述

### 1.1 目标

为广泛求职人群替换「表格 + 散落文档」方案（校招全流程是最完整的预置模板；社招等场景通过模板精简与字典定制适配），提供：

1. **投递记录核心**：一条投递 = 一个聚合对象（基本信息 + JD 快照 + 事件时间线 + 面试记录 + 关联简历版本 + 材料），看板/表格只是它的视图。
2. **状态机驱动**：状态不由手填，由事件时间线推导，解决飞书模板的"列爆炸"。
3. **结构化面试复盘**：每轮面试、每道题（题目/回答/表现/复盘/知识点标签）均可检索，沉淀个人错题本。
4. **多简历版本管理**：同一人多份简历（按岗位方向定制），每条投递必须标注所用的简历版本，后期可统计各版本过筛率。
5. **录入低摩擦**：浏览器扩展一键剪藏岗位（P1）、邮件解析自动生成事件草稿（P2，纯规则无 LLM）。
6. **数据主权**：全部数据本地 SQLite + 上传文件本地目录，可随时全量导出。

### 1.2 非目标（明确不做）

- 自动海投 / 自动打招呼（风控与法律风险）
- 云端多用户 SaaS、团队协作、公网部署
- LLM 功能（JD 匹配评分、AI 复盘、模拟面试等，按用户要求不做）
- 简历在线编辑器（只做版本管理与文件存储，编辑仍用 Word/LaTeX）
- App Store 上架（个人使用，ad-hoc 签名分发）

### 1.3 用户与场景

- 面向广泛求职者：应届校招（互联网/国企/银行/快消等，流程最全：网申→测评→笔试→群面→多轮面试→OC→意向→三方）、社招（投递→HR 沟通→面试→offer 的精简流程）、实习求职。首次启动按模板初始化（§3.6）。
- 每台设备单用户（个人数据），macOS；应用为常驻 Dock 的桌面窗口。
- 数据量级：校招重度用户 100–300 条投递，数千条事件/问题，SQLite 绰绰有余。
- 手机"面试后快速记题"场景降级为可选（P2：应用内嵌局域网移动页），非核心路径。

---

## 2. 总体架构与技术栈

### 2.1 形态：Tauri 2 原生 macOS 应用

```
┌─────────────────────────── FindYourJob.app ────────────────────────────┐
│  原生窗口（系统 WKWebView 渲染 UI，非捆绑 Chromium，体积 ~10MB）      │
│                                                                      │
│  前端 React 19 + TS + Vite + Tailwind + shadcn/ui + dnd-kit          │
│      │ Tauri IPC（tauri-specta 生成类型安全的 TS 绑定）               │
│  Rust 后端（Tauri 2 主进程）                                          │
│      ├── crate core   领域层：模型/状态机/服务/仓储（纯 Rust 可单测）  │
│      │     └── sqlx ──> SQLite (~/Library/Application Support/       │
│      │                   find-your-job (com.findyourjob)/findyourjob.db, WAL)              │
│      ├── 上传文件     data 目录：uploads/{resumes,attachments}/      │
│      ├── crate http   P1：axum 仅监听 127.0.0.1（扩展剪藏/局域网）    │
│      └── 插件         通知/文件对话框/opener/菜单托盘                 │
└──────────────────────────────────────────────────────────────────────┘
   浏览器扩展 (P1, WXT) ──Bearer token──> 127.0.0.1:37321/api/ext/clip
```

**关键分层**：所有业务逻辑在 `core` crate（不依赖 Tauri，纯函数 + sqlx 仓储），Tauri command 与 P1 的 axum handler 都只是它的薄封装——单测集中在 core，UI 与外部 API 两条通道复用同一套逻辑。

**选型理由**：
- 是不折不扣的 macOS 应用：.app bundle、Dock、原生窗口与菜单、系统通知、Keychain、文件拖拽，体积小启动快；
- UI 层直接复用成熟的 web 组件生态（看板拖拽 dnd-kit、表格、表单），"功能完善、交互要好"交付最快；
- Rust 枚举建模状态机，类型强度高于 TS，TDD 友好；作品集含 Rust + 前端完整工程。

**备选与否决**：SwiftUI + SwiftData（100% 原生但 UI 全部重写、P0 显著变慢，作为可切换备选保留）；Electron（捆绑 Chromium，重）；纯本地 Web（用户已否决）。

### 2.2 技术栈清单

| 层 | 选型 |
|---|---|
| 应用壳 | Tauri 2（macOS，WKWebView） |
| 前端 | React 19 + TypeScript + Vite + Tailwind + shadcn/ui + lucide-react |
| IPC 类型 | tauri-specta：Rust command/类型 → 自动生成 TS 绑定 |
| 状态/请求 | TanStack Query（包装 invoke） |
| 拖拽 | dnd-kit（看板拖列、题目排序） |
| 校验 | zod（表单层；`packages/shared` 存枚举与中文标签，P1 起与扩展共用） |
| Markdown | P0：textarea + 预览；P1 升级 bytemd |
| 后端 | Rust（cargo workspace）、serde、thiserror、tokio |
| DB | sqlx + SQLite（WAL），SQL 迁移文件管理 schema |
| 本地 HTTP (P1) | axum，仅 127.0.0.1，Bearer token，设置页开关 |
| 图表 (P1) | recharts |
| macOS 集成 | tauri-plugin-notification / dialog / opener；keyring crate (P2 邮件凭证入 Keychain)；菜单/快捷键 |
| 单测 | Rust cargo test（core）+ Vitest（前端组件/工具） |
| 应用级 E2E (P1) | tauri-driver + WebdriverIO（官方路径，需启用 safaridriver） |
| GUI 验收 | computer-use 驱动真实 .app 窗口（每里程碑一轮，截图存 `docs/acceptance/`） |
| 扩展 (P1) | WXT + React + TS（Manifest V3） |
| 邮件 (P2) | async-imap + mailparse（纯规则引擎） |
| 构建/签名 | `pnpm tauri build` → .app/.dmg，ad-hoc codesign（个人使用，右键打开过 Gatekeeper） |

### 2.3 仓库结构

```
find-your-job/
├── src/                     # React 前端（Vite 根）
│   ├── components/  app/(路由)  lib/  types/(specta 生成)
├── src-tauri/
│   ├── crates/core/         # 领域层：models/ state_machine/ services/ repos/（单测主战场）
│   ├── crates/http/         # P1 axum 封装
│   ├── src/                 # tauri 入口：commands(-> core)、插件、菜单
│   ├── migrations/          # sqlx SQL 迁移
│   └── tauri.conf.json
├── packages/shared/         # TS 枚举/标签/常量（前端 + P1 扩展共用）
├── docs/{design.md, acceptance/}
├── scripts/                 # backup 等
└── package.json / pnpm-workspace.yaml
```

### 2.4 数据与文件位置

- DB：`~/Library/Application Support/com.findyourjob/findyourjob.db`（Tauri `app_data_dir`，目录名取自应用标识符）
- 上传：同目录 `uploads/resumes/`、`uploads/attachments/`（按内容 hash 重命名防冲突）
- 备份：设置页「导出 JSON」+ 「在 Finder 中显示数据目录」；`scripts/backup.sh` 整目录快照

---

## 3. 数据库设计

### 3.1 ER 总览

```
Company 1───N Application N───1 ResumeVersion(可空但强烈建议)
                 │
                 ├──N ApplicationEvent（时间线事件）
                 ├──N Interview ──N InterviewQuestion
                 ├──N Attachment（多态：APPLICATION/INTERVIEW）
                 ├──N Reminder（P1，仅自定义提醒）
                 └──1 Contact(内推人，可空)
Contact N───1 Company（可空）
EmailAccount 1───N EmailParseLog ──?──1 Application（P2）
Setting（KV）
```

设计原则：
- **状态是派生缓存**：`Application.status` / `appliedDate` 由全部事件 + 面试重放（fold）得出，任何增删改在同一事务内重算。
- 枚举列在 SQL 层用 `CHECK` 约束兜底，应用层用 Rust enum（serde 序列化）+ 前端 zod 双重校验。
- 轻量多值字段（标签、别名）用 JSON 文本列。

### 3.2 表结构（SQL DDL 由迁移文件管理，字段与 v1.0 设计一致）

**company**：`id TEXT PK, name TEXT UNIQUE NOT NULL, aliases JSON DEFAULT '[]', industry?, nature?, website?, careers_url?, notes?, created_at, updated_at`

**resume_version**：`id, name NOT NULL（"算法岗版 v3"）, target_role?, file_name, file_path, file_size?, notes?, is_default DEFAULT 0, created_at, updated_at`

**contact**：`id, name, title?, email?, wechat?, phone?, notes?, company_id? FK, created_at, updated_at`

**application**：`id, company_id FK NOT NULL, position_title NOT NULL, department?, work_location?, channel DEFAULT 'COMPANY_SITE', batch DEFAULT 'FORMAL', priority DEFAULT 'MEDIUM', status DEFAULT 'SAVED', applied_date?, job_url?, jd_text?, jd_snapshot_at?, salary_range?, tags JSON DEFAULT '[]', resume_version_id? FK, referred_by_id? FK(contact), notes?, is_archived DEFAULT 0, created_at, updated_at`
索引：`status`、`company_id`、`applied_date`

**application_event**：`id, application_id FK CASCADE, type NOT NULL, occurred_at NOT NULL, deadline?, result?, note?, source DEFAULT 'MANUAL', created_at`
索引：`(application_id, occurred_at)`、`deadline`

**interview**：`id, application_id FK CASCADE, round INT NOT NULL, round_label?（一面/二面/HR面/群面/交叉面）, format?（PHONE/VIDEO/ONSITE/GROUP/AI）, scheduled_at?, duration_min?, location_or_link?, interviewer_note?, status DEFAULT 'SCHEDULED'（SCHEDULED/COMPLETED/CANCELLED）, outcome DEFAULT 'PENDING'（PENDING/PASS/FAIL/UNKNOWN）, self_rating?（1–5）, overall_reflection?, created_at, updated_at`
索引：`application_id`、`scheduled_at`

**interview_question**：`id, interview_id FK CASCADE, ordinal INT, question NOT NULL, my_answer?, quality DEFAULT 'UNKNOWN'（GOOD/OK/BAD/UNKNOWN）, reflection?, tags JSON DEFAULT '[]', created_at, updated_at`
索引：`interview_id`

**attachment**：`id, parent_type（APPLICATION/INTERVIEW）, parent_id, file_name, file_path, mime_type?, size?, created_at`；索引 `(parent_type, parent_id)`

**reminder**（P1）：`id, application_id? CASCADE, title, due_at, type DEFAULT 'CUSTOM', is_done DEFAULT 0, created_at`；索引 `(due_at, is_done)`

**email_account**（P2）：`id, host, port DEFAULT 993, secure DEFAULT 1, username, credential_ref?（Keychain 条目名，绝不存明文）, folder DEFAULT 'INBOX', enabled DEFAULT 1, last_sync_at?, created_at`

**email_parse_log**（P2）：`id, email_account_id FK, message_id UNIQUE, received_at, from_address, from_name?, subject, snippet?, raw_path?（.eml 落盘）, status DEFAULT 'PENDING'（PENDING/IMPORTED/IGNORED/UNMATCHED）, suggested_event_type?, suggested_deadline?, suggested_occurred_at?, matched_application_id?, match_reason?, note?, created_at`；索引 `status`

**setting**：`key TEXT PK, value_json, updated_at`

**dictionary**（用户可编辑字典，预置数据由迁移种子写入）：`id, category（CHANNEL/BATCH/ROUND_LABEL/...）, key UNIQUE(category,key), label, extra JSON（如图标、默认看板显隐）, sort, is_active, is_system（系统预置不可删，可隐藏）`

**custom_event_type**（自定义事件类型，见 §3.6）：`id, label, projection（映射到 §3.4 的某个状态投影，或 NO_CHANGE）, deadline_required INT, result_required INT, sort, is_active`

### 3.3 枚举定义（`packages/shared` + Rust enum 双份，值保持一致）

**分层原则**：`STATUS` 与 `EVENT_TYPE` 的**状态投影效果**属于状态机核心，固定不变（保证可测、可推理）；以下 CHANNEL/BATCH/轮次标签等**词汇层全部字典化**（§3.6），用户可增删改、隐藏预置项；`EVENT_TYPE` 支持基于固定投影集的自定义扩展类型。

**CHANNEL 渠道**：`COMPANY_SITE` 官网网申 · `BOSS` Boss直聘 · `NOWCODER` 牛客 · `SHIXISENG` 实习僧 · `LIEPIN` 猎聘 · `REFERRAL` 内推 · `EMAIL` 邮箱投递 · `JOBFAIR` 宣讲会/双选会 · `OTHER`

**BATCH 批次**：`EARLY` 提前批 · `FORMAL` 正式批 · `SPRING` 春招 · `SUPPLEMENT` 补录 · `DAILY_INTERN` 日常实习 · `VACATION_INTERN` 寒暑假实习 · `OTHER`

**STATUS 投递状态（看板列序）**：
`SAVED` 已保存 → `APPLIED` 已投递 → `ASSESSMENT` 测评中 → `WRITTEN` 笔试中 → `INTERVIEWING` 面试中 → `OC` 已OC → `INTENT` 意向书 → `OFFER` offer → `SIGNED` 已签约；旁路终态：`REJECTED` 已挂 · `WITHDRAWN` 已放弃

**EVENT_TYPE 事件类型**：

| 类型 | 中文 | 典型字段 |
|---|---|---|
| `APPLIED` | 已投递 | occurredAt=投递日 |
| `ASSESSMENT_INVITED` | 测评邀请 | **deadline**、note=链接 |
| `ASSESSMENT_DONE` | 测评完成 | result |
| `ASSESSMENT_FAILED` | 测评挂 | note |
| `WRITTEN_INVITED` | 笔试邀请 | **deadline**、note=链接 |
| `WRITTEN_DONE` | 笔试完成 | result |
| `WRITTEN_FAILED` | 笔试挂 | note |
| `RESUME_PASS` | 简历过筛 | — |
| `RESUME_FAIL` | 简历挂 | — |
| `HR_CONTACT` | HR沟通/约面 | note |
| `OC` | 口头offer | note=薪资口头沟通 |
| `INTENT_LETTER` | 意向书 | — |
| `OFFER` | 正式offer | 附件常用 |
| `DUAL_AGREEMENT` | 两方协议 | — |
| `TRIPLICATE` | 三方协议 | — |
| `SIGNED` | 已签约 | — |
| `REJECTED` | 已挂（通用） | note=挂在哪个环节 |
| `WITHDRAWN` | 主动放弃 | note=原因 |
| `NOTE` | 备注事件 | note（不改状态） |

**EVENT_RESULT**：`PENDING/PASS/FAIL/UNKNOWN`　**INTERVIEW_FORMAT**：`PHONE/VIDEO/ONSITE/GROUP/AI`
**INTERVIEW_STATUS**：`SCHEDULED/COMPLETED/CANCELLED`　**INTERVIEW_OUTCOME**：`PENDING/PASS/FAIL/UNKNOWN`
**QUESTION_QUALITY**：`GOOD/OK/BAD/UNKNOWN`　**EVENT_SOURCE**：`MANUAL/EXTENSION/EMAIL`

### 3.4 状态机（core crate 核心模块，TDD 先行）

`derive_status(&[TimelineItem]) -> Status` 为**纯函数**：输入该投递全部事件 + 面试（按时间排序），输出最终状态。服务层在任何事件/面试增删改后事务内重放，回写 `status` 与 `applied_date`。

**投影规则表**（按时间顺序应用，后者覆盖前者）：

| 输入 | 投影状态 |
|---|---|
| 建档（无任何事件） | SAVED |
| APPLIED | APPLIED |
| ASSESSMENT_INVITED / ASSESSMENT_DONE(非 FAIL) | ASSESSMENT |
| WRITTEN_INVITED / WRITTEN_DONE(非 FAIL) | WRITTEN |
| ASSESSMENT_FAILED / WRITTEN_FAILED / RESUME_FAIL / REJECTED | REJECTED |
| Interview(SCHEDULED) | INTERVIEWING |
| Interview(COMPLETED, outcome≠FAIL) | INTERVIEWING |
| Interview(COMPLETED, outcome=FAIL) | REJECTED |
| OC / INTENT_LETTER / OFFER / DUAL_AGREEMENT / TRIPLICATE | OC / INTENT / OFFER / OFFER / OFFER |
| SIGNED | SIGNED |
| WITHDRAWN | WITHDRAWN |
| RESUME_PASS / HR_CONTACT / NOTE | 不变 |

补充规则：
- **乱序补录**：按时间全量重放，天然支持补录历史事件与回改。
- **rejectedStage（挂在哪一阶段）**：查询时由末次 FAIL 类事件前到达的最高阶段推导，用于漏斗统计，不落列。
- Rust 侧 `#[derive]` + match 穷尽实现；表驱动单测覆盖全组合 + 乱序 + 删除重算 + 面试取消不产生 REJECTED 等边界。

### 3.5 时间线视图模型

详情页时间线 = 事件与面试**合并按时间排序**的统一列表（面试含题目数徽标）；合并逻辑在 Rust core 实现（唯一事实源），前端只渲染。

### 3.6 可定制字典与场景模板（面向广泛求职群体）

不同人群的流程词汇差异很大（校招有测评/群面/三方，社招基本没有；银行有英语笔试，互联网有手撕代码）。方案：**核心状态机固定，词汇层全面开放**。

1. **首次启动模板向导**：校招完整版 / 社招精简版 / 实习版 / 空白。模板决定：预置字典启用了哪些项、看板默认显示哪些列（社招隐藏 ASSESSMENT/WRITTEN/INTENT 列）、哪些事件类型出现在"添加事件"菜单。
2. **字典可编辑**：渠道、批次、面试轮次标签、城市等均为 `dictionary` 表数据；系统预置项 `is_system=1` 不可删但可隐藏/改名。
3. **自定义事件类型**：用户可新增事件类型（如"背调""体检""资格复审""材料提交"），每个类型声明：状态投影（映射到 §3.4 固定投影之一或 NO_CHANGE）+ 是否需要 deadline + 是否需要 result。`derive_status` 的类型→投影映射表作为参数传入（内置类型固定映射 + 自定义类型读库），纯函数性质与表驱动测试不破坏。
4. **看板列显隐**存 `setting`，各模板给默认值。

---

## 4. 接口设计

### 4.1 Tauri Commands（P0 主通道，IPC 无需开端口）

| 分组 | 命令 |
|---|---|
| 投递 | `list_applications(filter)` `get_application(id)` `create_application` `update_application` `delete_application` `set_archived` |
| 事件 | `add_event(applicationId, input)` `update_event` `delete_event`（均触发状态重算） |
| 面试 | `add_interview` `update_interview` `delete_interview`；`add_question` `update_question` `delete_question` `reorder_questions` |
| 公司 | `search_companies(query)` `upsert_company` |
| 简历 | `list_resumes` `upload_resume(path)` `delete_resume` `set_default_resume` |
| 附件 | `upload_attachment(parentType, parentId, path)` `list_attachments` `delete_attachment` `open_attachment`（调 opener，系统预览） |
| 数据 | `export_json` `import_json` `reveal_data_dir`（Finder 显示） |
| 设置 | `get_settings` `update_settings` |
| P1 | `list_reminders` `create_reminder` `complete_reminder`；`get_stats`；`export_csv` `import_csv`；`start_local_api/stop` |
| P2 | 邮件账户/同步/审核；`set_pin` `verify_pin` |

### 4.2 本地 HTTP API（P1，crate http，axum）

- 仅当设置页开启「扩展接入」时启动，绑定 `127.0.0.1:37321`，全部路由要求 `Authorization: Bearer <token>`（设置页生成/重置）。
- 路由：`POST /api/ext/clip`（扩展剪藏）；P2 可选：局域网移动页（只读+快速加题）挂同一端口。
- handler 直接调 core 服务层，与 IPC 同源逻辑。

---

## 5. 页面与交互设计

### 5.1 窗口与导航（原生观感要点）

- 原生窗口 + 侧边栏导航（仪表盘/投递/简历库/公司/联系人 P1/日历 P1/面经 P2/offer P2/设置），toolbar 内联于标题栏（macOS 风格交通灯）。
- 标准 macOS 快捷键：⌘N 新建投递、⌘F 搜索、⌘W 关窗、⌘, 设置；P1 ⌘K 命令面板。
- 深色模式跟随系统；全中文界面。
- 附件拖拽：窗口级 onDragDrop 直接上传到当前上下文（投递/面试）。
- 日期选择：WKWebView 原生 datetime 输入体验差，**自研 DatePicker 组件**（统一交互）。

### 5.2 页面地图

| 路由 | 里程碑 | 内容 |
|---|---|---|
| `/` 仪表盘 | P0 简版 / P1 完整 | P0：今日/3 日内截止 + 未来面试 + 最近动态；P1：漏斗、渠道/批次分布、周投递曲线、沉默投递（>14 天无事件）、简历版本过筛率 |
| `/applications` | P0 | 看板/表格双视图 |
| `/applications/:id` | P0 | 详情页（下详） |
| `/resumes` | P0 | 简历版本库：卡片（名称/方向/大小/默认/被引用数）、上传/替换/设默认 |
| `/companies` | P0 简版 | 列表 + 编辑（主要在投递表单内自动补全新建） |
| `/contacts`、`/calendar` | P1 | 联系人；月历（面试/截止/提醒三色） |
| `/review` | P2 | 面经知识库：标签聚合、错题本（BAD+高频）、全文检索 |
| `/offers` | P2 | offer 对比打分器（维度自定义加权） |
| `/settings` | P0→P2 | 导出导入（P0）、提醒与 webhook、API token、扩展接入开关（P1）、邮件账户与解析审核、PIN（P2） |

### 5.3 投递详情页（产品灵魂）

```
┌ 美团 · 运筹优化算法工程师 [面试中] [提前批] [高优先]  ✏️ 🗑
│ Base 北京 · 到家事业群 · 渠道:官网 · 简历版本: 算法岗v3 ▾ · 内推人: 张三
├ Tabs: [时间线] [面试记录] [JD 快照] [材料] [基本信息]
│
│ 时间线：合并事件+面试的垂直时间轴，倒序，每项可展开编辑；
│   「+ 添加事件」行内表单——类型切换动态出字段：
│   邀请类→deadline；完成类→result；都带 note
│ 面试：轮次卡片 → 逐题编辑器（题/答/表现/复盘/标签chips，自动补全、拖拽排序）
│ JD：Markdown 渲染 + 编辑；显示快照时间；「打开原链接」（opener）
│ 材料：附件拖拽上传 + 简历版本切换
└
```

### 5.4 看板与拖拽（状态机友好交互）

拖动卡片到目标列 = **快捷创建对应事件**（状态不直接改），落下列后弹预填确认表单：

| 拖到列 | 预填事件 |
|---|---|
| 已投递 | APPLIED（今天） |
| 测评中 | ASSESSMENT_INVITED（必填 deadline） |
| 笔试中 | WRITTEN_INVITED（必填 deadline） |
| 面试中 | 提示去「+ 添加面试」 |
| OC/意向书/offer/已签约 | 对应事件 |
| 已挂 | REJECTED（note 预填"拖拽标记"） |
| 已放弃 | WITHDRAWN |

看板卡片：公司+岗位、部门、批次 badge、紧急点（deadline ≤3 天红色）、面试轮次进度点（●●○）；列头计数。

### 5.5 表格视图与检索

- 默认列：公司/岗位/状态/批次/渠道/Base/投递日/最近事件/简历版本/紧急；列显隐可配（P1 保存视图）。
- 筛选：状态(多选)/渠道/批次/城市/标签/简历版本/归档；全文搜索（公司、岗位、部门、备注、JD、面试题）。

### 5.6 录入效率与新手引导（贯穿三期）

- **首次启动模板向导**（§3.6）：选校招/社招/实习/空白模板 → 直接得到贴合自己流程的看板与事件菜单，非技术用户零配置可用。
- 新建投递单弹窗：公司自动补全（无则就地新建）、粘贴 JD 入快照、**简历版本必选**（无版本时"先去上传"或跳过+黄条提醒）、下拉默认值。
- ⌘K 命令面板（P1）。
- 深色模式（P0）。

---

## 6. 浏览器扩展（P1，apps/extension）

- WXT + React + TS，MV3；图标 + 右键菜单"剪藏此岗位"，**仅手动触发，绝不自动弹窗/静默写入**。
- 提取三层：① 站点适配器（Boss直聘/牛客/猎聘/实习僧 DOM 规则）② 通用 `JobPosting` JSON-LD（公司官网大多有）③ 兜底启发式（title + 主体文本，人工修正）。
- 弹出确认表单（预填可改）→ `POST http://127.0.0.1:37321/api/ext/clip`（Bearer token）→ 落为 `SAVED` 投递，成功提示"去完善"。
- 数据不落扩展本地，应用是唯一事实源。

## 7. 邮件解析（P2，模块 K 唯一保留项；纯规则，无 LLM）

- async-imap（IDLE + 定时拉取）+ mailparse；凭证存 **macOS Keychain**（keyring crate），DB 只存 credentialRef。
- 流水线：拉取未读 → messageId 去重 → 规则引擎：① 发件域名 ↔ `company.website`/`aliases` 匹配 → 候选公司；② 关键词分类（测评/笔试/面试/意向书/offer/感谢信…）；③ 正则提取截止与面试时间；④ 候选公司 × 岗位 token 关联现有投递（多候选并列供选）。
- 产出全部进 `email_parse_log(PENDING)`，审核收件箱 UI 逐条确认/忽略/改绑后转正式事件（source=EMAIL）；原文 .eml 落盘可重解析。**无任何静默写入。**
- 测试：`crates/core/tests/fixtures/emails/*.eml` 仿真语料 ≥30 封（各类型/乱序/陷阱）驱动规则单测；支持手动导入 .eml 调试。

---

## 8. 测试与验收策略（每里程碑硬门禁）

1. **Rust 单测（cargo test，core crate 为主）**
   - 状态机 `derive_status`：投影规则表驱动全覆盖 + 乱序补录 + 删除重算 + 边界（CANCELLED 面试、NOTE 不改状态等）；
   - 时间线合并排序、deadline 紧急度、CSV 映射（P1）、邮件规则 vs fixtures（P2）；
   - 仓储/服务层用临时 SQLite（tempfile）跑集成测试。
2. **前端单测（Vitest + Testing Library）**：表单校验、看板拖拽映射（列→事件预填）、关键组件渲染。
3. **应用级 E2E（P1 起）**：tauri-driver + WebdriverIO（macOS 需启用 safaridriver），覆盖 8 条主流程。
4. **computer-use GUI 验收（用户要求，每里程碑必做）**：启动 .app，用 computer-use 以辅助功能驱动真实窗口走验收清单，截图存 `docs/acceptance/P{x}-*.png`，问题当场修复后重验。
5. 完成定义：单测全绿 → E2E 通过（P1 起）→ GUI 验收清单全过 → 更新 README 截图。

---

## 9. 里程碑计划

### P0 — 核心记录器（目标：两周内可自用，替换飞书）

| 步骤 | 内容 | 验收点 |
|---|---|---|
| 1 | 脚手架：pnpm workspace、Tauri 2 + Vite + React 模板、cargo workspace（core 独立 crate）、sqlx 迁移建表（含字典表与预置种子）、shared 枚举 | `pnpm tauri dev` 起窗口；DB 建表成功 |
| 2 | **core：模型 + 状态机 + 单测（先于一切业务代码，TDD）** | 投影表覆盖 100% |
| 3 | core：仓储 + 服务层（事务内状态重算）+ 临时库集成测试 | 测试通过：事件写入后状态自动重算 |
| 4 | Tauri commands + specta 类型生成；前端骨架（导航/深色/DatePicker 组件/首次启动模板向导） | IPC 全 CRUD 可调；向导可用 |
| 5 | 投递列表：看板（拖拽→事件确认弹窗）+ 表格（筛选/搜索） | 拖拽落列弹确认，状态正确流转 |
| 6 | 详情页：时间线行内加事件 / 面试+逐题编辑 / JD / 材料 | 全流程可录改删 |
| 7 | 简历版本库 + 投递关联（未标版本黄条提醒） | 表格可见简历列 |
| 8 | 设置：JSON 全量导出/导入、Finder 显示数据目录、备份脚本 | 导出→清库→导入回环一致 |
| 9 | Vitest + **computer-use 验收第一轮**（驱动真实 .app） | 清单：新建含简历版本的投递 → 三类事件 → 看板列变化 → 加 2 轮面试 6 题 → 搜索 → 导出 |

### P1 — 效率与提醒

| 步骤 | 内容 |
|---|---|
| 1 | crate http：axum 本地 API + token + 设置页开关 |
| 2 | 浏览器扩展（WXT）：四站点适配器 + JSON-LD 通用 + 剪藏确认流 |
| 3 | 提醒：deadline 派生（截止前 3 天/1 天/当天）+ 面试前（前一晚 + 前 2h"面试预习卡"：JD+历轮记录）+ 自定义提醒 + 系统通知（tauri-plugin-notification）+ 可选飞书/企业微信 webhook |
| 4 | 日历视图（自定义月历三色） |
| 5 | 统计看板（漏斗、渠道/批次/城市分布、周曲线、沉默投递、简历版本过筛率） |
| 6 | 联系人管理 + 内推人关联 |
| 7 | CSV 导出（飞书模板兼容列）/ CSV 导入向导（迁移存量飞书数据） |
| 8 | ⌘K 命令面板；表格保存视图；WebdriverIO E2E 接入 |
| 9 | **computer-use 验收第二轮**（含扩展在真实 Boss/牛客页面剪藏） |

### P2 — 复盘沉淀与邮件

| 步骤 | 内容 |
|---|---|
| 1 | 面经知识库 `/review`：标签聚合、错题本（BAD+高频）、全文检索 |
| 2 | offer 对比器：维度（base×月/签字费/股票/补贴、城市、部门、加班、稳定）自定义加权 |
| 3 | 邮件解析全链路（§7）：Keychain 凭证、同步、审核 UI、.eml 调试 |
| 4 | PIN 锁（应用级门禁） |
| 5 | 可选：局域网移动页（同 token，面试后手机快速记题）、菜单栏速览（今日截止） |
| 6 | **computer-use 验收第三轮** |

---

## 10. 风险与对策

| 风险 | 对策 |
|---|---|
| WKWebView 原生控件体验差（datetime 输入等） | 自研 DatePicker 等关键输入组件，不依赖原生表单控件 |
| Rust 学习/异步复杂度 | 领域逻辑集中在 core crate 纯函数化，Tauri 层保持薄 |
| tauri-driver E2E 环境依赖 safaridriver | P0 不依赖 E2E（单测+computer-use 达标），P1 再接入 |
| 招聘站点 DOM 变化致扩展失效 | 适配器隔离 + JSON-LD 通用层兜底 + 确认表单人工修正 |
| 邮件规则误判 | 一律 PENDING 人工确认，无静默写入；原文 .eml 保留可重解析 |
| sqlx 异步样板代码多 | 仓储层统一封装查询助手，服务层不直接碰 sqlx |
| 数据安全 | 本地 SQLite + WAL；备份脚本；PIN（P2）门禁；无任何外发（webhook 为显式配置） |
| 自己秋招时间冲突 | P0 严格砍到自用最小集；P1/P2 秋招后迭代 |

---

## 11. 决策点记录

1. **形态**：macOS 原生应用（.app、Dock、原生窗口）——已确认。**UI 技术路线：Tauri 2 + React + Rust —— 已确认（2026-08-29）**。
2. **受众**：已从"计算机专业研究生"扩展为广泛求职群体——预置模板（校招/社招/实习/空白）+ 字典全面可定制（§3.6），核心状态机保持固定集合。
3. **P0 范围**：§9 P0 表（含简历版本管理）—— 待确认。
4. UI 全中文、深色模式跟随系统 —— 已确认。
5. （2026-08-29 交付后用户决策）「剪藏」措辞全部改为「收录」；浏览器扩展输出目录改为可见的 build/；**邮件解析功能整体移除**（.eml 导入 UI 与 IPC 已删，core 内规则引擎代码与表结构保留为休眠，未来如需 IMAP 可复用）。
