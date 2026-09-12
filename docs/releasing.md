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

同时更新 Cargo 锁文件、README 下载链接及 App / 扩展兼容性说明。发布前检查待提交文件，不得包含真实数据库、简历、密钥或个人截图。

## Developer ID 签名与公证发布

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

## 本地签名发布

尚未配置 Apple 开发者签名凭据时，可以发布明确标注限制的本地签名包：

1. 运行前端和扩展类型检查、测试、Rust 格式检查、Clippy、workspace 测试及依赖审计。
2. `pnpm app:install` 构建当前机器架构的 App / DMG 并安装；`pnpm --filter fyj-extension zip` 构建扩展。
3. 检查 DMG 校验和、只读挂载后的版本/架构/签名及 Applications 快捷方式，检查 ZIP 完整性和 manifest 版本。
4. 提交并 push 到 main，等待 CI；创建对应版本 tag 和 Draft Release，附加 DMG 与 `FindYourJob-browser-extension-vVERSION.zip`。
5. 在发布说明中明确实际提供的架构、最低系统版本、扩展最低浏览器版本、升级方式，以及“ad-hoc 签名、未经过 Apple 公证”。不得把本地签名校验通过写成 Gatekeeper / 公证通过。
6. 验证上传文件 SHA-256，确认草稿中两个附件齐全后公开 Release。

历史 Release 和 tag 不覆盖；本机构建后以 `/Applications/FindYourJob.app` 为准，构建目录不保留 App 副本。
