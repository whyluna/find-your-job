# FindYourJob

macOS 原生求职投递记录与面试复盘应用（Tauri 2 + React + Rust + SQLite）。本地优先，数据完全存在自己电脑上。

- 设计文档：[docs/design.md](docs/design.md)
- 状态由事件时间线推导（状态机），一条投递 = 一个聚合对象：基本信息 + JD 快照 + 事件 + 面试逐题记录 + 简历版本关联
- 面向广泛求职群体：校招/社招/实习模板，渠道/批次/事件类型字典可自定义

## 开发

```bash
pnpm install        # 安装前端依赖
pnpm tauri dev      # 启动桌面应用（开发模式）
pnpm tauri build    # 打包 .app / .dmg
pnpm test           # 前端单测（Vitest）
cargo test          # Rust 单测（在 src-tauri 下，core crate 为主战场）
```

数据库与上传文件位于 `~/Library/Application Support/find-your-job/`。
