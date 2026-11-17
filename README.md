# GlanceSpace

Windows x64 磁盘空间分析器。P0 提供只读扫描、逻辑大小与磁盘占用、Canvas treemap、目录列表、过滤和钻取；不会修改被扫描文件。

## 开发环境

- Windows 10 22H2+ / Windows 11 x64
- Node.js 24+
- Rust stable MSVC toolchain
- Microsoft WebView2 Runtime

## 运行

```powershell
npm install
npm run desktop
```

前端预览：

```powershell
npm run dev
```

预览页面不会访问本机文件系统；真实扫描必须通过 Tauri 桌面程序运行。

## 检查

```powershell
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run desktop:build -- --debug
```

## 当前边界

首版只扫描本机固定磁盘，普通用户运行，不跟随 junction、symlink 和其他 reparse point。扫描结果保存在 Rust 内存中；P0 不做 AI、删除、SQLite 扫描热路径、完整快照或实时 Watch。项目标准见 [AGENTS.md](AGENTS.md)，接手背景见 [HANDOFF.md](HANDOFF.md)。
