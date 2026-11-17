import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { branchItems, collapseExpanded, emptyProgress, formatBytes, metricValue, navigate } from './model.ts';
import type { FsNode, History, MapMode, Metric, Page, Progress, TreeView } from './model.ts';
import Treemap from './Treemap.tsx';
import type { Rect } from './treemap.ts';
import ContextMenu from './ContextMenu.tsx';
import type { MenuTarget } from './ContextMenu.tsx';

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
  const [tree, setTree] = useState<TreeView | null>(null);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [mode, setMode] = useState<MapMode>(() => localStorage.getItem('glancespace.mapMode') === 'navigate' ? 'navigate' : 'expand');
  const [mapOnly, setMapOnly] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [opening, setOpening] = useState(false);
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
  useEffect(() => { localStorage.setItem('glancespace.mapMode', mode); }, [mode]);
  useEffect(() => { setExpanded([]); setMenu(null); }, [scanId, nodeId, mode]);
  useEffect(() => { setSelected(null); }, [nodeId]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (menu) setMenu(null); else setMapOnly(false); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [menu]);
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
          invoke<TreeView>('get_view', { scanId, nodeId, metric, expanded }),
        ]);
        if (!disposed) {
          setPage(nextPage); setTree(nextTree); lastRevision = p.revision;
          const nodes = [nextPage.directory, ...nextPage.items, ...nextTree.items, ...nextTree.branches.flatMap(b => b.items)];
          setSelected(old => old ? nodes.find(n => n.id === old.id) ?? old : nextPage.directory);
        }
      } catch (e) { if (!disposed) setError(String(e)); }
      finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(() => { if (!['completed', 'cancelled', 'failed'].includes(phase.current) || lastRevision < 0) void refresh(); }, 350);
    return () => { disposed = true; clearInterval(timer); };
  }, [scanId, nodeId, metric, offset, filter, progress.phase, expanded]);

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
      setTree(null); setExpanded([]); setMenu(null);
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
  const mapItems = useMemo(() => tree?.directory.id === nodeId ? branchItems(tree) : [], [tree, nodeId]);
  const branches = useMemo(() => new Map(tree?.branches.map(b => [b.directory.id, branchItems(b)]) ?? []), [tree]);
  const allNodes = useMemo(() => tree ? [...tree.items, ...tree.branches.flatMap(b => b.items)] : [], [tree]);
  function mapClick(rect: Rect) {
    const node = rect.node;
    setSelected(node);
    if (!node.isDir || node.state === 'skipped') return;
    if (mode === 'navigate' || rect.width < 160 || rect.height < 100) { drill(node); return; }
    if (expanded.includes(node.id)) { setExpanded(ids => collapseExpanded(ids, node.id, allNodes)); return; }
    if (node.childCount === 0) return;
    let next = expanded;
    if (next.length >= 16) {
      const parents = new Map(allNodes.map(n => [n.id, n.parent]));
      const ancestors = new Set<number>();
      let parent = node.parent;
      while (parent !== null && parent !== undefined && !ancestors.has(parent)) { ancestors.add(parent); parent = parents.get(parent) ?? null; }
      const oldest = next.find(id => !ancestors.has(id));
      if (oldest === undefined) { drill(node); return; }
      next = collapseExpanded(next, oldest, allNodes);
    }
    setExpanded([...next, node.id]);
  }
  const closeMenu = useCallback(() => setMenu(null), []);
  function context(node: FsNode, x: number, y: number) {
    if (scanId === null || node.id < 0 || opening) return;
    setSelected(node); setMenu({ node, scanId, x, y });
  }
  async function external(action: 'open_with' | 'show_in_explorer', target: MenuTarget) {
    closeMenu(); setOpening(true); setError('');
    try {
      const message = await invoke<string | null>(action, { scanId: target.scanId, nodeId: target.node.id });
      if (message) setError(message);
    } catch (e) { setError(String(e)); }
    finally { setOpening(false); }
  }
  const selectedNode = selected ?? page?.directory;

  return <div className={`app-shell ${mapOnly ? 'map-only' : ''}`}>
    <main className="main">
      <section className="scan-bar normal-only" aria-label="扫描控制">
        <strong className="app-name">GlanceSpace</strong>
        <select aria-label="固定磁盘" value="" disabled={running || starting} onChange={e => setRoot(e.target.value)}><option value="">磁盘</option>{drives.map(d => <option key={d} value={d}>{d}</option>)}</select>
        <label className="path-field"><Icon name="folder" /><input aria-label="扫描目录" value={root} disabled={running || starting} onChange={e => setRoot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && desktop) void start(); }} placeholder="例如 D:\\Projects" /></label>
        <button className="button subtle" onClick={() => void browse()} disabled={!desktop || running || starting}>选择目录</button>
        <button className="button primary" onClick={() => void start()} disabled={!desktop || running || starting}>{starting ? '正在启动…' : scanId ? '重新扫描' : '开始扫描'} <span>↗</span></button>
        {running && <><button className="button subtle" disabled={progress.phase === 'cancelling'} onClick={() => void control(progress.phase === 'paused' ? 'resume' : 'pause')}>{progress.phase === 'paused' ? '继续' : '暂停'}</button><button className="button danger" disabled={progress.phase === 'cancelling'} onClick={() => void control('cancel')}>取消</button></>}
      </section>
      {!desktop && <div className="notice normal-only">界面预览 · 运行 <code>npm run desktop</code> 扫描本机磁盘</div>}
      <section className="stats normal-only" aria-label="扫描统计">
        <div className="stat"><span>已知磁盘占用</span><strong>{formatBytes(progress.diskSize)}</strong><small>{progress.unknown ? `${progress.unknown.toLocaleString()} 项大小未知，当前为已知下限` : '文件分配占用 · 未去重硬链接'}</small></div>
        <div className="stat"><span>逻辑大小</span><strong>{formatBytes(progress.logicalSize)}</strong><small>文件内容长度</small></div>
        <div className="stat"><span>发现项目</span><strong>{(progress.files + progress.directories).toLocaleString()}<em>项</em></strong><small>{progress.files.toLocaleString()} 文件 · {progress.directories.toLocaleString()} 目录</small></div>
        <div className="stat"><span>扫描状态</span><strong className={`status-text ${progress.phase === 'scanning' ? 'scanning' : ''}`}><i />{phases[progress.phase] ?? progress.phase}</strong><small>{(progress.elapsedMs / 1000).toFixed(1)} 秒 · {progress.errors} 错误 · {progress.skipped} 跳过</small></div>
      </section>
      <section className="explorer">
        <div className="explorer-toolbar"><div className="navigation">
          <button aria-label="后退" disabled={history.index === 0} onClick={() => { setHistory(h => ({ ...h, index: h.index - 1 })); setOffset(0); }}><Icon name="arrow" size={16} /></button>
          <button aria-label="前进" disabled={history.index === history.ids.length - 1} onClick={() => { setHistory(h => ({ ...h, index: h.index + 1 })); setOffset(0); }}><span className="forward"><Icon name="arrow" size={16} /></span></button>
          <button aria-label="回到扫描根目录" disabled={!page || nodeId === 0} onClick={() => page && drill(page.breadcrumbs[0])}>⌂</button>
        </div><nav className="breadcrumbs" aria-label="当前目录">{page ? page.breadcrumbs.map((n, i) => <span key={n.id}>{i > 0 && <i>/</i>}<button title={n.path} onClick={() => drill(n)}>{i === 0 ? n.path : n.name}</button></span>) : <span>选择一个目录，开始探索</span>}</nav>
        <div className="segmented" role="group" aria-label="大小口径"><button aria-pressed={metric === 'disk'} className={metric === 'disk' ? 'chosen' : ''} onClick={() => setMetric('disk')}>磁盘占用</button><button aria-pressed={metric === 'logical'} className={metric === 'logical' ? 'chosen' : ''} onClick={() => setMetric('logical')}>逻辑大小</button></div>
        <div className="segmented" role="group" aria-label="矩阵操作模式"><button aria-pressed={mode === 'expand'} className={mode === 'expand' ? 'chosen' : ''} onClick={() => setMode('expand')}>展开模式</button><button aria-pressed={mode === 'navigate'} className={mode === 'navigate' ? 'chosen' : ''} onClick={() => setMode('navigate')}>切换模式</button></div>
        <button className="button subtle" aria-pressed={mapOnly} onClick={() => { setMapOnly(v => !v); closeMenu(); }}>{mapOnly ? '退出仅矩阵' : '仅矩阵'}</button></div>
        {(error || progress.message || opening) && <div className="error" role={opening ? 'status' : 'alert'}><span title={error || progress.message || ''}>{opening ? '正在调用系统文件操作…' : error || progress.message}</span>{error && <button aria-label="关闭提示" onClick={() => setError('')}>×</button>}</div>}
        <div className="visual-row"><div className="map-panel"><div className="panel-caption"><strong>空间矩阵</strong><span>{mode === 'expand' ? '单击展开 · 小块进入目录' : '单击进入目录'} · 右键操作</span></div><Treemap key={`${scanId}:${nodeId}`} items={mapItems} branches={branches} metric={metric} selected={selectedNode?.id} onActivate={mapClick} onSelect={setSelected} onContext={context} onCollapse={ids => setExpanded(old => ids.reduce((next, id) => collapseExpanded(next, id, allNodes), old))} /><div className="map-legend"><span>面积：{metric === 'disk' ? '磁盘占用' : '逻辑大小'} · 条纹：部分未知</span><span>{phases[progress.phase]}{tree?.truncated || tree?.branches.some(b => b.truncated) ? ' · 其他项目已合并' : ''}</span></div></div>
          <aside className="inspector normal-only" aria-label="所选项目详情"><h2 title={selectedNode?.name}>{selectedNode?.name || '项目详情'}</h2>{selectedNode ? <>
            <button className="detail-path" title={`${selectedNode.path}（点击复制）`} onClick={() => void navigator.clipboard.writeText(selectedNode.path).catch(e => setError(String(e)))}>{selectedNode.path}</button><div className={`state-chip ${selectedNode.complete ? '' : 'warning'}`}>{nodeState(selectedNode)}</div>
            <dl><dt>磁盘占用</dt><dd>{sizeLabel(selectedNode, 'disk')}</dd><dt>逻辑大小</dt><dd>{sizeLabel(selectedNode, 'logical')}</dd><dt>修改日期</dt><dd>{date(selectedNode.modified)}</dd></dl>
            {selectedNode.message && <p className="detail-message" title={selectedNode.message}>{selectedNode.message}</p>}
            {selectedNode.isDir && selectedNode.state !== 'skipped' && selectedNode.id !== nodeId && <button className="button subtle full" onClick={() => drill(selectedNode)}>进入此目录 →</button>}
          </> : <p className="detail-placeholder">选择项目查看详情；右键可使用系统打开方式。</p>}</aside>
        </div>
      </section>
      <section className="list-panel normal-only" aria-label="目录列表">
        <div className="list-toolbar"><strong>目录内容 <small>{page?.total.toLocaleString() ?? '0'} 项</small></strong><div className="filters">
          <input aria-label="文件名过滤" maxLength={256} value={pattern} onChange={e => setPattern(e.target.value)} placeholder="筛选名称或 *.zip" />
          <select aria-label="项目类型" value={filter.kind} onChange={e => { setFilter(f => ({ ...f, kind: e.target.value })); setOffset(0); }}><option value="all">全部类型</option><option value="directory">目录</option><option value="file">文件</option></select>
          <input aria-label="最小大小 MiB" className="number-filter" type="number" min="0" max="1000000000" value={filter.minSize} onChange={e => { setFilter(f => ({ ...f, minSize: e.target.value })); setOffset(0); }} placeholder="≥ MiB" />
          <input aria-label="至少未修改天数" className="number-filter" type="number" min="0" max="100000" step="1" value={filter.olderThanDays} onChange={e => { setFilter(f => ({ ...f, olderThanDays: e.target.value })); setOffset(0); }} placeholder="≥ 天未修改" />
        </div></div>
        <div className="table-wrap"><table><thead><tr><th>名称</th><th>磁盘占用{metric === 'disk' && ' ↓'}</th><th>逻辑大小{metric === 'logical' && ' ↓'}</th><th>修改日期</th><th>状态</th></tr></thead><tbody>
          {page?.items.map(node => <tr key={node.id} className={selectedNode?.id === node.id ? 'selected-row' : ''} onClick={() => setSelected(node)} onDoubleClick={() => drill(node)} onContextMenu={e => { e.preventDefault(); context(node, e.clientX, e.clientY); }} onKeyDown={e => {
            if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); context(node, bounds.left + 30, bounds.top + 24); }
          }}>
            <td><button className="file-name" title={node.path} onClick={() => setSelected(node)} onKeyDown={e => { if (e.key === 'Enter') drill(node); }}><span className={node.isDir ? 'folder-icon' : 'file-icon'}>{node.isDir ? '▣' : '▪'}</span><span>{node.name}</span></button></td><td>{sizeLabel(node, 'disk')}</td><td>{sizeLabel(node, 'logical')}</td><td>{date(node.modified)}</td><td><span className={`table-state ${node.complete ? '' : 'warning'}`}>{nodeState(node)}</span></td>
          </tr>)}
          {!page?.items.length && <tr><td colSpan={5} className="table-empty">{scanId === null ? '扫描后在这里浏览文件和目录' : running ? '正在发现项目，或当前筛选没有匹配项' : '当前目录没有匹配项目'}</td></tr>}
        </tbody></table></div>
        <div className="list-footer"><span>列表筛选作用于当前目录 · 未知占用不参与大小筛选</span><div><button disabled={!page || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>上一页</button><span>{page?.total ? `${offset + 1}–${Math.min(offset + 100, page.total)} / ${page.total}` : '0 / 0'}</span><button disabled={!page || offset + 100 >= page.total} onClick={() => setOffset(offset + 100)}>下一页</button></div></div>
      </section>
    </main>
    {menu && <ContextMenu key={`${menu.scanId}:${menu.node.id}:${menu.x}:${menu.y}`} target={menu} onClose={closeMenu} onAction={(action, target) => void external(action, target)} />}
  </div>;
}
