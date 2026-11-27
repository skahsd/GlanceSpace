export const languageLabels = { 'zh-CN': '简体中文', en: 'English' } as const;
export type Language = keyof typeof languageLabels;
export const defaultLanguage: Language = 'zh-CN';

// Each entry has the same placeholders in both languages.
const messages = {
  idle: ["等待扫描", "Ready to scan"],
  ready: ["准备中", "Preparing…"],
  scanning: ["正在扫描", "Scanning…"],
  paused: ["已暂停", "Paused"],
  cancelling: ["正在取消", "Cancelling…"],
  cancelled: ["已取消 · 结果不完整", "Cancelled · Partial results"],
  completed: ["扫描结束", "Scan complete"],
  failed: ["扫描失败", "Scan failed"],
  unknown: ["未知", "Unknown"],
  skipped: ["已跳过", "Skipped"],
  partial: ["部分未知", "Partly unknown"],
  incomplete: ["未完成", "Incomplete"],
  counted: ["已统计", "Counted"],
  scanControls: ["扫描控制", "Scan controls"],
  fixedDrives: ["固定磁盘", "Fixed drives"],
  drive: ["磁盘", "Drive"],
  scanFolder: ["扫描目录", "Scan folder"],
  browse: ["选择目录", "Browse"],
  starting: ["正在启动…", "Starting…"],
  rescan: ["重新扫描", "Scan again"],
  start: ["开始扫描", "Scan"],
  resume: ["继续", "Resume"],
  pause: ["暂停", "Pause"],
  cancel: ["取消", "Cancel"],
  viewSettings: ["视图设置", "View settings"],
  modules: ["显示模块", "Visible modules"],
  map: ["空间矩阵", "Treemap"],
  list: ["目录内容", "Folder contents"],
  details: ["详情", "Details"],
  alwaysOn: ["始终显示", "Always on"],
  font: ["界面字号", "Text size"],
  small: ["小", "Small"],
  standard: ["标准", "Standard"],
  large: ["大", "Large"],
  theme: ["主题", "Theme"],
  dark: ["深色", "Dark"],
  light: ["浅色", "Light"],
  language: ["界面语言", "Language"],
  reset: ["恢复默认", "Reset defaults"],
  preview: ["界面预览 · 运行 {command} 扫描本机磁盘", "UI preview · Run {command} to scan local drives"],
  back: ["后退", "Back"],
  forward: ["前进", "Forward"],
  scanRoot: ["回到扫描根目录", "Go to scan root"],
  currentFolder: ["当前目录", "Current folder"],
  chooseFolder: ["选择一个目录，开始探索", "Choose a folder to get started"],
  sizeMetric: ["大小口径", "Size metric"],
  disk: ["磁盘占用", "Size on disk"],
  logical: ["逻辑大小", "Logical size"],
  mapMode: ["矩阵操作模式", "Treemap click mode"],
  expand: ["展开模式", "Expand"],
  navigate: ["切换模式", "Drill down"],
  mapOnly: ["仅矩阵", "Treemap only"],
  exitMapOnly: ["退出仅矩阵", "Exit treemap only"],
  opening: ["正在调用系统文件操作…", "Opening Windows file action…"],
  dismiss: ["关闭提示", "Dismiss notice"],
  scanSizes: ["本次扫描大小", "Scan sizes"],
  scanTotal: ["本次扫描合计", "Scan totals"],
  unknownDisk: ["本次扫描有 {count} 项磁盘占用未知", "Unknown size on disk for {count} entries"],
  legend: ["面积：{metric} · 条纹：部分未知", "Area: {metric} · Stripes: partly unknown"],
  merged: ["其他项目已合并", "Other entries grouped"],
  selectedDetails: ["所选项目详情", "Selected item details"],
  itemDetails: ["项目详情", "Item details"],
  copyPath: ["{path}（点击复制）", "{path} (click to copy)"],
  modified: ["修改日期", "Modified"],
  enterFolder: ["进入此目录 →", "Open in treemap →"],
  detailHint: ["选择项目查看详情；右键可使用系统打开方式。", "Select an item for details. Right-click for Windows file actions."],
  folderList: ["目录列表", "Folder list"],
  itemCount: ["{count} 项", "{count} entries"],
  filterName: ["文件名过滤", "Filter by name"],
  filterPlaceholder: ["筛选名称或 *.zip", "Name or *.zip"],
  itemType: ["项目类型", "Item type"],
  allTypes: ["全部类型", "All types"],
  folders: ["目录", "Folders"],
  files: ["文件", "Files"],
  minSize: ["最小大小 MiB", "Minimum size in MiB"],
  minAge: ["至少未修改天数", "Minimum days since modification"],
  minAgePlaceholder: ["≥ 天未修改", "≥ days old"],
  name: ["名称", "Name"],
  status: ["状态", "Status"],
  listEmpty: ["扫描后在这里浏览文件和目录", "Files and folders appear here after scanning starts"],
  listScanning: ["正在发现项目，或当前筛选没有匹配项", "Discovering items or no matches for the current filters"],
  noMatches: ["当前目录没有匹配项目", "No matching items in this folder"],
  filterNote: ["列表筛选作用于当前目录 · 未知占用不参与大小筛选", "Filters apply to this folder · Unknown sizes are excluded by size filters"],
  previous: ["上一页", "Previous"],
  next: ["下一页", "Next"],
  folderDialog: ["选择本机固定磁盘上的目录", "Choose a folder on a local fixed drive"],
  pathExample: ["例如 D:\\Projects", "e.g. D:\\Projects"],
  mapA11y: ["磁盘空间矩阵。单击目录执行所选模式，右键打开菜单。方向键选择项目，Enter 操作，Shift+F10 打开菜单。", "Disk usage treemap. Click a folder to apply the selected mode. Use arrow keys to select, Enter to activate, and Shift+F10 to open the menu."],
  mapEmpty: ["空间分布将在这里展开", "Disk usage will appear here"],
  mapHint: ["选择目录并开始扫描；零字节和未知大小条目可在列表中查看。", "Choose a folder and scan. The list includes zero-byte entries and entries with unknown sizes."],
  knownPart: ["已知部分", "Known size"],
  otherItems: ["其他项目（在列表查看）", "Other entries (see list)"],
  itemActions: ["{name} 的操作", "Actions for {name}"],
  openWith: ["打开方式…", "Open with…"],
  explorerOpen: ["在资源管理器中打开", "Open in File Explorer"],
  explorerShow: ["在资源管理器中显示", "Show in File Explorer"],
} as const;

export type MessageKey = keyof typeof messages;
export type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export function translator(language: Language): Translate {
  const column = language === 'en' ? 1 : 0;
  return (key, values) => messages[key][column].replace(/\{(\w+)\}/g, (match, name) => String(values?.[name] ?? match));
}

// Translate app diagnostics at display time so existing scan results can switch languages too.
const diagnosticLabels = new Map([
  ['请选择本机固定磁盘上的绝对目录路径', 'Choose an absolute folder path on a local fixed drive'],
  ['首版不支持 UNC、网络路径或设备路径', 'UNC, network, and device paths are unsupported'],
  ['仅支持带盘符的本机目录', 'Choose a local folder with a drive letter'],
  ['首版仅支持本机固定磁盘，不支持网络盘或可移动磁盘', 'Only local fixed drives are supported'],
  ['扫描路径不能包含 ..', 'Scan paths cannot contain ..'],
  ['不能以重解析点、联接目录或云端占位目录作为扫描根路径', 'A reparse point, junction, or cloud placeholder cannot be the scan root'],
  ['扫描目标必须是目录', 'The scan target must be a folder'],
  ['条目已变为重解析点或云端占位文件，跳过占用读取', 'Size lookup skipped because the item became a reparse point or cloud placeholder'],
  ['文件系统返回了无效占用', 'The file system returned an invalid size on disk'],
  ['扫描任务已启动', 'A scan is already running'],
  ['扫描线程异常退出，结果不完整', 'The scan stopped unexpectedly. Results are incomplete'],
  ['当前任务已结束或正在取消', 'The scan has ended or is being cancelled'],
  ['扫描开始前根目录已变为重解析点，未跟随', 'The scan root became a reparse point before scanning and was skipped'],
  ['扫描开始前根目录已消失或不可访问', 'The scan root disappeared or became inaccessible before scanning'],
  ['重解析点或云端占位条目，未跟随、未下载', 'Reparse point or cloud placeholder. The target was neither followed nor downloaded'],
  ['条目数量超过索引上限', 'The number of entries exceeds the index limit'],
  ['节点不存在', 'Item not found'],
  ['过滤表达式不能超过 256 个字符', 'Filters cannot exceed 256 characters'],
  ['每页条目数必须在 1 到 500 之间', 'Page size must be between 1 and 500'],
  ['未知项目类型过滤', 'Unknown item type filter'],
  ['大小过滤范围无效', 'Invalid size filter range'],
  ['该节点不可展开', 'This item cannot be expanded'],
  ['目录不存在', 'Folder not found'],
  ['最多展开 16 个目录', 'At most 16 folders can be expanded'],
  ['展开节点不存在', 'Expanded item not found'],
  ['展开节点必须是当前视图内的子目录', 'Only subfolders of the current view can be expanded'],
  ['展开节点不在当前可见目录内', 'The expanded item is outside the visible folders'],
  ['目标不在扫描范围内', 'The target is outside the scan scope'],
  ['不能打开重解析点或云端占位项目，请使用资源管理器处理', 'Open this reparse point or cloud placeholder in File Explorer'],
  ['项目类型在扫描后发生变化，请重新扫描', 'The item type changed after scanning. Scan again'],
  ['扫描状态不可用', 'Scan status unavailable'],
  ['扫描任务已失效，请重新扫描', 'This scan is no longer available. Scan again'],
  ['请先取消或等待当前扫描结束', 'Cancel the current scan or wait for it to end'],
  ['未知扫描操作', 'Unknown scan action'],
  ['目录请使用资源管理器打开', 'Open folders in File Explorer'],
  ['已在资源管理器中定位', 'Located the item in File Explorer'],
  ['系统文件操作线程异常', 'The Windows file action stopped unexpectedly'],
]);
const diagnosticPrefixes = [
  ['无法访问目录：', 'Cannot access folder: '],
  ['目录不可用：', 'Folder unavailable: '],
  ['无法读取磁盘占用：', 'Cannot read size on disk: '],
  ['磁盘占用读取失败：', 'Size on disk lookup failed: '],
  ['无法读取元数据：', 'Cannot read metadata: '],
  ['无法访问：', 'Access failed: '],
  ['项目已不存在或无法访问：', 'The item is missing or inaccessible: '],
  ['无法初始化系统文件操作：', 'Cannot initialize Windows file actions: '],
  ['打开方式调用失败：', 'Open with failed: '],
  ['资源管理器打开失败：', 'Could not open in File Explorer: '],
  ['无法定位项目：', 'Could not locate the item: '],
  ['资源管理器定位失败：', 'Could not locate the item in File Explorer: '],
] as const;

export function localizeDiagnostic(message: string, language: Language): string {
  if (language !== 'en') return message;
  // shortcut: the current IPC returns strings, switch to message codes when the IPC contract is revised.
  // The only compound diagnostic is the Explorer fallback following an Open with error.
  const separator = message.lastIndexOf('；');
  if (separator > 0) {
    const fallback = message.slice(separator + 1);
    const translated = translateDiagnostic(fallback);
    if (translated !== fallback) return `${translateDiagnostic(message.slice(0, separator))} · ${translated}`;
  }
  return translateDiagnostic(message);
}

function translateDiagnostic(message: string): string {
  const label = diagnosticLabels.get(message);
  if (label) return label;
  const prefix = diagnosticPrefixes.find(([source]) => message.startsWith(source));
  return prefix ? prefix[1] + message.slice(prefix[0].length) : message;
}
