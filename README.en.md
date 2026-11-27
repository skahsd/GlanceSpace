# GlanceSpace

[简体中文](README.md) · **English**

GlanceSpace is a disk space analyzer for Windows. Its interactive treemap shows how much space files and folders use, so you can quickly find the largest items.

[Download the Windows x64 installer](https://github.com/skahsd/GlanceSpace/releases/download/v0.1.0/GlanceSpace_0.1.0_x64-setup.exe) · [View all releases](https://github.com/skahsd/GlanceSpace/releases)

## Screenshots

![The standard GlanceSpace view with the treemap, selected folder details, and folder contents](docs/screenshots/overview.png)

**Standard view.** Select a folder in the treemap to see its contents in the list below.

![GlanceSpace in Treemap only mode with the MySQL and Microsoft VS Code folders expanded](docs/screenshots/treemap-only.png)

**Treemap only mode.** Hide the folder list and details to give the treemap more room while keeping the scan controls. Press `Esc` to return to the standard view.

## Features

- Scan local fixed drives and folders, and browse results as they appear. Pause, resume, or cancel a scan.
- Switch between **Size on disk** and **Logical size**. Size on disk reflects the allocated space, while logical size reflects the recorded file length.
- Expand large folders in place or use Drill down mode to navigate into a folder. Filter the folder list by name, type, size, or days since modification.
- Use the context menu to open a file with a Windows app or open and locate items in File Explorer.
- Choose Simplified Chinese or English, either theme, and one of three text sizes. The light theme and standard text size are the defaults.

## Installation and usage

1. Run `GlanceSpace_0.1.0_x64-setup.exe` on Windows 10 version 22H2 or Windows 11 (x64).
2. Open GlanceSpace, choose a local fixed drive or a folder on it, and click **Scan**.
3. Select an item in the treemap to see its details. Expand a folder and select its children to explore where the space is used.

Scans read file system metadata with standard user permissions. GlanceSpace marks inaccessible items and any size on disk it cannot reliably measure. It skips the targets of symbolic links, junctions, and other reparse points.

## Run from source

You need Windows x64, Node.js 24+, the stable Rust MSVC toolchain, Visual Studio C++ Build Tools, and Microsoft Edge WebView2 Runtime.

Run these commands from the repository root.

```powershell
npm ci
npm run desktop
```

Use `npm run dev` to preview the frontend. Disk scanning requires the desktop app.

### Tests and builds

```powershell
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run desktop:build -- --debug
```

`npm run desktop:build -- --debug` builds the debug executable. See the [project guidelines](AGENTS.md), [verification notes](docs/P0-VERIFICATION.md), and [D3 license notice](THIRD-PARTY-D3-LICENSE.txt) for details.
