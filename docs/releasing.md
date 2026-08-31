# macOS 发布检查清单

正式发布前同步修改以下版本号：

- `package.json`
- `packages/shared/package.json`
- `apps/extension/package.json`
- `apps/extension/wxt.config.ts`
- `src-tauri/Cargo.toml`
- `src-tauri/crates/core/Cargo.toml`
- `src-tauri/crates/http/Cargo.toml`
- `src-tauri/tauri.conf.json`

GitHub 仓库需要配置这些 Actions Secrets：

- `APPLE_CERTIFICATE`：Developer ID Application `.p12` 的 Base64
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`
- `APPLE_ID`
- `APPLE_PASSWORD`：Apple ID App-Specific Password
- `APPLE_TEAM_ID`

在 Actions 中手动运行 **Publish macOS release**。流水线会运行测试，分别构建 Apple Silicon 与 Intel DMG，完成签名、公证，并创建 Draft Release；Apple Silicon 任务还会附加浏览器扩展 ZIP。

发布 Draft 前必须人工完成：

```bash
hdiutil verify FindYourJob_VERSION_ARCH.dmg
spctl --assess --type execute --verbose=4 /path/to/FindYourJob.app
codesign --verify --deep --strict /path/to/FindYourJob.app
```

然后挂载两个 DMG，确认：

1. `FindYourJob.app` 与 `Applications` 快捷方式都存在；
2. 首次启动不需要绕过 Gatekeeper；
3. 数据库升级、系统凭据库、浏览器扩展接入和核心页面均通过真实环境验收；
4. Release 文案明确列出数据迁移、兼容性和已知限制。
