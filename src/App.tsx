import { useEffect, useRef, useState } from 'react';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { emptyProgress, formatBytes, metricValue, navigate } from './model.ts';
import type { FsNode, History, Metric, Page, Progress, TreeView } from './model.ts';
import Treemap from './Treemap.tsx';

const phases: Record<string, string> = { idle: '等待扫描', ready: '准备中', scanning: '正在扫描', paused: '已暂停', cancelling: '正在取消', cancelled: '已取消 · 结果不完整', completed: '扫描结束', failed: '扫描失败' };
const terminal = (p: Progress) => ['idle', 'completed', 'cancelled', 'failed'].includes(p.phase);
const date = (value: number | null) => value === null ? '未知' : new Date(value * 1000).toLocaleDateString('zh-CN');
const nodeState = (node: FsNode) => node.state === 'skipped' ? '已跳过' : node.state === 'partial' ? '部分未知' : !node.complete ? '未完成' : '已统计';
const sizeLabel = (node: FsNode, metric: Metric) => `${metric === 'disk' && node.unknown ? '≥ ' : ''}${formatBytes(metricValue(node, metric))}`;

function Icon({ name, size = 18 }: { name: 'map' | 'folder' | 'drive' | 'arrow' | 'shield'; size?: number }) {
  const paths = {
    map: 'M3 3h18v18H3z M3 10h10 M13 3v18 M13 15h8',
    folder: 'M3 7V5h7l2 2h9v13H3z',
    drive: 'M5 4h14l3 12H2z M2 16v4h20v-4 M16 18h1 M19 18h1',
    arrow: 'M15 5l-7 7 7 7',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function App() {
  const [root, setRoot] = useState(() => localStorage.getItem('glancespace.recentPath') || 'D:\\');
  const [metric, setMetric] = useState<Metric>(() => localStorage.getItem('glancespace.metric') === 'logical' ? 'logical' : 'disk');
  const [drives, setDrives] = useState<string[]>([]);
  const [scanId, setScanId] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [history, setHistory] = useState<History>({ ids: [0], index: 0 });
  const [page, setPage] = useState<Page | null>(null);
  const [tree, setTree] = useState<TreeView>({ items: [], truncated: false, omittedLogicalSize: 0, omittedDiskSize: 0 });
  const [selected, setSelected] = useState<FsNode | null>(null);
  const [pattern, setPattern] = useState('');
  const [filter, setFilter] = useState({ pattern: '', kind: 'all', minSize: '', olderThanDays: '' });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const phase = useRef('idle');
  phase.current = progress.phase;
  const nodeId = history.ids[history.index];
  const running = !terminal(progress);
  const desktop = isTauri();

  useEffect(() => {
    if (desktop) invoke<string[]>('list_drives').then(setDrives).catch(e => setError(String(e)));
  }, [desktop]);
  useEffect(() => { localStorage.setItem('glancespace.metric', metric); }, [metric]);
  useEffect(() => {
    const timer = setTimeout(() => { setFilter(f => ({ ...f, pattern })); setOffset(0); }, 220);
    return () => clearTimeout(timer);
  }, [pattern]);
  useEffect(() => {
    if (scanId === null) return;
    let disposed = false;
    let busy = false;
    let lastRevision = -1;
    async function refresh() {
      if (busy || disposed) return;
      busy = true;
      try {
        const p = await invoke<Progress>('get_progress', { scanId });
        if (disposed) return;
        setProgress(p);
        if (p.revision === lastRevision) return;
        const query = { nodeId, offset, limit: 100, metric, pattern: filter.pattern, kind: filter.kind,
          minSize: filter.minSize ? Math.floor(Number(filter.minSize) * 1024 ** 2) : null,
          olderThanDays: filter.olderThanDays ? Number(filter.olderThanDays) : null };
        const [nextPage, nextTree] = await Promise.all([
          invoke<Page>('get_children', { scanId, query }),
          invoke<TreeView>('get_view', { scanId, nodeId, metric }),
        ]);
        if (!disposed) {
          setPage(nextPage); setTree(nextTree); lastRevision = p.revision;
          setSelected(old => old && (old.id === nodeId || old.parent === nodeId)
            ? nextPage.items.find(n => n.id === old.id) || (old.id === nodeId ? nextPage.directory : old) : nextPage.directory);
        }
      } catch (e) { if (!disposed) setError(String(e)); }
      finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(() => { if (!['completed', 'cancelled', 'failed'].includes(phase.current) || lastRevision < 0) void refresh(); }, 850);
    return () => { disposed = true; clearInterval(timer); };
  }, [scanId, nodeId, metric, offset, filter, progress.phase]);

  async function start() {
    if (!root.trim() || starting || running) return;
    setStarting(true); setError('');
    const currentGeneration = ++generation.current;
    const channel = new Channel<Progress>();
    channel.onmessage = data => { if (generation.current === currentGeneration) setProgress(data); };
    try {
      const id = await invoke<number>('start_scan', { root: root.trim(), onProgress: channel });
      localStorage.setItem('glancespace.recentPath', root.trim());
      setHistory({ ids: [0], index: 0 }); setOffset(0); setSelected(null); setPage(null);
      setTree({ items: [], truncated: false, omittedLogicalSize: 0, omittedDiskSize: 0 });
      setScanId(id);
    } catch (e) { setError(String(e)); }
    finally { setStarting(false); }
  }
  async function control(action: string) {
    try { setProgress(await invoke<Progress>('control_scan', { scanId, action })); }
    catch (e) { setError(String(e)); }
  }
  async function browse() {
    try { const result = await open({ directory: true, multiple: false, title: '选择本机固定磁盘上的目录' }); if (typeof result === 'string') setRoot(result); }
    catch (e) { setError(String(e)); }
  }
  function drill(node: FsNode) {
    if (node.id < 0 || !node.isDir || node.state === 'skipped') return;
    setHistory(h => navigate(h, node.id)); setOffset(0); setSelected(node); setError('');
  }
  const mapItems = [...tree.items];
  if (tree.truncated && page) mapItems.push({ ...page.directory, id: -1, parent: page.directory.id, name: '其他项目（在列表查看）',
    isDir: false, logicalSize: tree.omittedLogicalSize, diskSize: tree.omittedDiskSize, childCount: 0 });
  const selectedNode = selected ?? page?.directory;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><i /><i /><i /></span><span>GlanceSpace<small>磁盘空间分析器</small></span></div>
      <div className="nav-heading">工作空间</div>
      <div className="nav-item active"><Icon name="map" />空间概览<span className="nav-dot" /></div>
      <div className="nav-heading drives-heading">本机固定磁盘</div>
      {drives.map(drive => <button className={`drive-item ${root.toLowerCase().startsWith(drive.toLowerCase()) ? 'current' : ''}`} key={drive} disabled={running} onClick={() => setRoot(drive)}><Icon name="drive" /><span>本地磁盘 <strong>{drive.slice(0, 2)}</strong></span></button>)}
      {!drives.length && <p className="sidebar-note">{desktop ? '正在读取磁盘…' : '请通过桌面应用扫描本机磁盘'}</p>}
      <div className="safe-note"><Icon name="shield" size={22} /><strong>只读分析模式</strong><p>扫描文件元数据。所有文件保留在原处。</p></div>
      <div className="sidebar-footer">P0 · Windows x64 <span>v0.1.0</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">DISK EXPLORER</span><h1>看清空间，找到重点。</h1></div><div className="mode-badge"><span />本地分析 · 无数据上传</div></header>
      <section className="scan-bar" aria-label="扫描控制">
        <label className="path-field"><Icon name="folder" /><input aria-label="扫描目录" value={root} disabled={running || starting} onChange={e => setRoot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && desktop) void start(); }} placeholder="例如 D:\\Projects" /></label>
        <button className="button subtle" onClick={() => void browse()} disabled={!desktop || running || starting}>选择目录</button>
        <button className="button primary" onClick={() => void start()} disabled={!desktop || running || starting}>{starting ? '正在启动…' : scanId ? '重新扫描' : '开始扫描'} <span>↗</span></button>
        {running && <><button className="button subtle" disabled={progress.phase === 'cancelling'} onClick={() => void control(progress.phase === 'paused' ? 'resume' : 'pause')}>{progress.phase === 'paused' ? '继续' : '暂停'}</button><button className="button danger" disabled={progress.phase === 'cancelling'} onClick={() => void control('cancel')}>取消</button></>}
      </section>
      {!desktop && <div className="notice">当前为界面预览。请运行 <code>npm run desktop</code> 使用真实磁盘扫描。</div>}
      {error && <div className="error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div>}
      <section className="stats" aria-label="扫描统计">
        <div className="stat"><span>已知磁盘占用</span><strong>{formatBytes(progress.diskSize)}</strong><small>{progress.unknown ? `${progress.unknown.toLocaleString()} 项大小未知，当前为已知下限` : '文件分配占用 · 未去重硬链接'}</small></div>
        <div className="stat"><span>逻辑大小</span><strong>{formatBytes(progress.logicalSize)}</strong><small>文件内容长度</small></div>
        <div className="stat"><span>发现项目</span><strong>{(progress.files + progress.directories).toLocaleString()}<em>项</em></strong><small>{progress.files.toLocaleString()} 文件 · {progress.directories.toLocaleString()} 目录</small></div>
        <div className="stat"><span>扫描状态</span><strong className={`status-text ${progress.phase === 'scanning' ? 'scanning' : ''}`}><i />{phases[progress.phase] ?? progress.phase}</strong><small>{(progress.elapsedMs / 1000).toFixed(1)} 秒 · {progress.errors} 错误 · {progress.skipped} 跳过</small></div>
      </section>
      {progress.message && <div className="error" role="alert">{progress.message}</div>}
      <section className="explorer">
        <div className="explorer-toolbar"><div className="navigation">
          <button aria-label="后退" disabled={history.index === 0} onClick={() => { setHistory(h => ({ ...h, index: h.index - 1 })); setOffset(0); }}><Icon name="arrow" size={16} /></button>
          <button aria-label="前进" disabled={history.index === history.ids.length - 1} onClick={() => { setHistory(h => ({ ...h, index: h.index + 1 })); setOffset(0); }}><span className="forward"><Icon name="arrow" size={16} /></span></button>
          <button aria-label="回到扫描根目录" disabled={!page || nodeId === 0} onClick={() => page && drill(page.breadcrumbs[0])}>⌂</button>
        </div><nav className="breadcrumbs" aria-label="当前目录">{page ? page.breadcrumbs.map((n, i) => <span key={n.id}>{i > 0 && <i>/</i>}<button title={n.path} onClick={() => drill(n)}>{i === 0 ? n.path : n.name}</button></span>) : <span>选择一个目录，开始探索</span>}</nav>
        <div className="segmented" role="group" aria-label="大小口径"><button className={metric === 'disk' ? 'chosen' : ''} onClick={() => setMetric('disk')}>磁盘占用</button><button className={metric === 'logical' ? 'chosen' : ''} onClick={() => setMetric('logical')}>逻辑大小</button></div></div>
        <div className="visual-row"><div className="map-panel"><div className="panel-caption"><strong>空间矩形图</strong><span>单击查看 · 双击目录钻取</span></div><Treemap items={mapItems} metric={metric} selected={selectedNode?.id} onSelect={setSelected} onOpen={drill} /><div className="map-legend"><span><i />面积代表{metric === 'disk' ? '磁盘占用' : '逻辑大小'}</span><span>条纹表示部分未知{tree.truncated ? ' · 其余项目合并展示' : ''}</span></div></div>
          <aside className="inspector" aria-label="所选项目详情"><span className="eyebrow">SELECTION</span><h2>{selectedNode?.name || '项目详情'}</h2>{selectedNode ? <>
            <p className="detail-path">{selectedNode.path}</p><div className={`state-chip ${selectedNode.complete ? '' : 'warning'}`}>{nodeState(selectedNode)}</div>
            <dl><dt>磁盘占用</dt><dd>{sizeLabel(selectedNode, 'disk')}</dd><dt>逻辑大小</dt><dd>{sizeLabel(selectedNode, 'logical')}</dd><dt>类型</dt><dd>{selectedNode.isDir ? '目录' : '文件'}</dd><dt>修改日期</dt><dd>{date(selectedNode.modified)}</dd><dt>直接子项</dt><dd>{selectedNode.isDir ? selectedNode.childCount.toLocaleString() : '—'}</dd></dl>
            {selectedNode.message && <p className="detail-message">{selectedNode.message}</p>}
            {selectedNode.isDir && selectedNode.state !== 'skipped' && selectedNode.id !== nodeId && <button className="button subtle full" onClick={() => drill(selectedNode)}>进入此目录 →</button>}
          </> : <p className="detail-placeholder">点击矩形或列表中的项目，查看路径、大小和扫描状态。</p>}<div className="inspector-foot"><Icon name="shield" size={15} />文件名不是清理依据</div></aside>
        </div>
      </section>
      <section className="list-panel" aria-label="目录列表">
        <div className="list-toolbar"><strong>目录内容 <small>{page?.total.toLocaleString() ?? '0'} 项</small></strong><div className="filters">
          <input aria-label="文件名过滤" maxLength={256} value={pattern} onChange={e => setPattern(e.target.value)} placeholder="筛选名称或 *.zip" />
          <select aria-label="项目类型" value={filter.kind} onChange={e => { setFilter(f => ({ ...f, kind: e.target.value })); setOffset(0); }}><option value="all">全部类型</option><option value="directory">目录</option><option value="file">文件</option></select>
          <input aria-label="最小大小 MiB" className="number-filter" type="number" min="0" max="1000000000" value={filter.minSize} onChange={e => { setFilter(f => ({ ...f, minSize: e.target.value })); setOffset(0); }} placeholder="≥ MiB" />
          <input aria-label="至少未修改天数" className="number-filter" type="number" min="0" max="100000" step="1" value={filter.olderThanDays} onChange={e => { setFilter(f => ({ ...f, olderThanDays: e.target.value })); setOffset(0); }} placeholder="≥ 天未修改" />
        </div></div>
        <div className="table-wrap"><table><thead><tr><th>名称</th><th>磁盘占用{metric === 'disk' && ' ↓'}</th><th>逻辑大小{metric === 'logical' && ' ↓'}</th><th>修改日期</th><th>状态</th></tr></thead><tbody>
          {page?.items.map(node => <tr key={node.id} className={selectedNode?.id === node.id ? 'selected-row' : ''} onClick={() => setSelected(node)} onDoubleClick={() => drill(node)}>
            <td><button className="file-name" title={node.path} onClick={() => setSelected(node)} onKeyDown={e => { if (e.key === 'Enter') drill(node); }}><span className={node.isDir ? 'folder-icon' : 'file-icon'}>{node.isDir ? '▣' : '▪'}</span><span>{node.name}</span></button></td><td>{sizeLabel(node, 'disk')}</td><td>{sizeLabel(node, 'logical')}</td><td>{date(node.modified)}</td><td><span className={`table-state ${node.complete ? '' : 'warning'}`}>{nodeState(node)}</span></td>
          </tr>)}
          {!page?.items.length && <tr><td colSpan={5} className="table-empty">{scanId === null ? '扫描后在这里浏览文件和目录' : running ? '正在发现项目，或当前筛选没有匹配项' : '当前目录没有匹配项目'}</td></tr>}
        </tbody></table></div>
        <div className="list-footer"><span>列表筛选作用于当前目录 · 未知占用不参与大小筛选</span><div><button disabled={!page || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><span>{page?.total ? `${offset + 1}–${Math.min(offset + 100, page.total)} / ${page.total}` : '0 / 0'}</span><button disabled={!page || offset + 100 >= page.total} onClick={() => setOffset(offset + 100)}>下一页</button></div></div>
      </section>
      <footer className="main-footer"><span><span className="tiny-dot" />{scanId === null ? '准备就绪' : `任务 #${scanId} · ${phases[progress.phase]}`}</span><span>未跟随重解析点 · 不统计 ADS · 不对硬链接去重</span></footer>
    </main>
  </div>;
}
