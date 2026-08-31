# Contributing to FindYourJob

感谢你改进 FindYourJob。提交改动前请先确认它符合“本地优先、不静默写入、流程状态由事件推导”的产品原则。

## 本地开发

需要 Node.js 22+、pnpm 11 和稳定版 Rust：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --workspace --all-targets -- -D warnings
cd src-tauri && cargo test --workspace
```

浏览器扩展使用：

```bash
pnpm --filter fyj-extension build
```

`pnpm tauri build` 只构建，不会修改 `/Applications`。项目维护者需要构建并替换本机安装版时使用 `pnpm app:install`。

## 提交要求

- 新功能必须包含与风险相称的测试。
- 数据库迁移必须兼容已有用户数据，不得静默删除或重写个人资料。
- UI 改动需要检查浅色/深色、960×640 最小窗口、键盘操作和 VoiceOver 语义。
- 不要提交真实简历、招聘邮件、数据库、Token、API Key 或包含个人信息的截图。

安全问题请不要创建公开 Issue，改按 [SECURITY.md](SECURITY.md) 中的方式报告。
