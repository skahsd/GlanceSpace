# GlanceSpace

Windows x64 磁盘空间分析器。P0 提供只读扫描、逻辑大小与磁盘占用、Canvas treemap、目录列表、过滤和钻取。右键可主动调用系统打开方式或资源管理器；外部应用的编辑和保存由该应用负责。

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

## 矩阵操作

- **展开模式**：单击大目录块在原位展示子项，点击目录标题可收起；小块直接进入目录。
- **切换模式**：单击目录即切换整个矩阵。文件单击只选中，矩阵没有独立双击操作。
- **仅矩阵**：隐藏其他模块，按钮或 Esc 恢复；目录列表是唯一允许滚动的区域。
- 文件或目录右键打开共用菜单；支持菜单键、Shift+F10、方向键和 Enter。系统选择框取消不触发资源管理器兜底。
- 视图最多 5000 个真实节点、16 个展开目录；各分支按配额截断并显示“其他项目”，列表分页仍可访问全部条目。

## 界面回归检查

`scripts/check-ui.cjs` 使用可选的 Playwright 与本机 Edge，在受控 IPC 样本上检查布局、模式切换、右键与键盘交互。它不访问真实磁盘，也不能替代原生 Shell 验证。

先运行 `npm run dev`；在另一个终端中运行 `node scripts/check-ui.cjs`。需要环境已有 `playwright`，可通过 `NODE_PATH` 指向已有工具链的 node_modules；不将该工具引入应用运行依赖。

## 当前边界

首版只扫描本机固定磁盘，普通用户运行，不跟随 junction、symlink 和其他 reparse point。扫描结果保存在 Rust 内存中；P0 不做 AI、删除、SQLite 扫描热路径、完整快照或实时 Watch。项目标准见 [AGENTS.md](AGENTS.md)，接手背景见 [HANDOFF.md](HANDOFF.md)。
