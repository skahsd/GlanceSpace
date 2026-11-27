import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { branchItems, collapseExpanded, emptyProgress, formatBytes, metricValue, navigate } from './model.ts';
import type { FsNode, History, MapMode, Metric, Page, Progress, TreeView } from './model.ts';
import Treemap from './Treemap.tsx';
import type { Rect } from './treemap.ts';
import ContextMenu from './ContextMenu.tsx';
import type { MenuTarget } from './ContextMenu.tsx';
import { defaultView, fontSizes, moduleKeys, readView, themes, toggleModule } from './viewSettings.ts';
import type { FontSize } from './viewSettings.ts';
import type { CSSProperties } from 'react';
import { languageLabels, localizeDiagnostic, translator } from './i18n.ts';
import type { Language, MessageKey } from './i18n.ts';

const phaseLabels: Partial<Record<string, MessageKey>> = {
  idle: 'idle', ready: 'ready', scanning: 'scanning', paused: 'paused', cancelling: 'cancelling',
  cancelled: 'cancelled', completed: 'completed', failed: 'failed',
};
const fontLabels = ['small', 'standard', 'large'] as const;
const terminal = (p: Progress) => ['idle', 'completed', 'cancelled', 'failed'].includes(p.phase);
const nodeState = (node: FsNode): MessageKey => node.state === 'skipped' ? 'skipped' : node.state === 'partial' ? 'partial' : !node.complete ? 'incomplete' : 'counted';

function Icon({ name, size = 18 }: { name: 'map' | 'folder' | 'drive' | 'arrow' | 'shield' | 'view' | 'scan'; size?: number }) {
  const paths = {
    scan: 'M9 3H4v5 M15 3h5v5 M20 16v5h-5 M4 16v5h5 M3 12h18',
    view: 'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
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
  const [view, setView] = useState(() => readView(localStorage.getItem('glancespace.view')));
  const [showViewSettings, setShowViewSettings] = useState(false);
  const viewSettings = useRef<HTMLDivElement>(null);
  const viewButton = useRef<HTMLButtonElement>(null);
  const { modules, language } = view;
  const t = useMemo(() => translator(language), [language]);
  const sizeLabel = (node: FsNode, metric: Metric) =>
    `${metric === 'disk' && node.unknown ? '≥ ' : ''}${formatBytes(metricValue(node, metric), t('unknown'))}`;
  const date = (value: number | null) => value === null ? t('unknown') : new Date(value * 1000).toLocaleDateString(language);
  const [pattern, setPattern] = useState('');
  const [filter, setFilter] = useState({ pattern: '', kind: 'all', minSize: '', olderThanDays: '' });
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const generation = useRef(0);
  const phase = useRef('idle');
  phase.current = progress.phase;
  const nodeId = history.ids[history.index];
  const [listNodeId, setListNodeId] = useState(nodeId);
  const running = !terminal(progress);
  const desktop = isTauri();

  useEffect(() => {
    if (desktop) invoke<string[]>('list_drives').then(setDrives).catch(e => setError(String(e)));
  }, [desktop]);
  useEffect(() => { localStorage.setItem('glancespace.metric', metric); }, [metric]);
  useEffect(() => { localStorage.setItem('glancespace.view', JSON.stringify(view)); }, [view]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => {
    if (!showViewSettings) return;
    const close = (e: PointerEvent) => { if (!viewSettings.current?.contains(e.target as Node)) setShowViewSettings(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [showViewSettings]);
  useEffect(() => { localStorage.setItem('glancespace.mapMode', mode); }, [mode]);
  useEffect(() => { setExpanded([]); setMenu(null); }, [scanId, nodeId, mode]);
  useEffect(() => { setListNodeId(nodeId); }, [nodeId]);
  useEffect(() => { setSelected(null); }, [nodeId]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (menu) setMenu(null);
      else if (showViewSettings) { setShowViewSettings(false); viewButton.current?.focus(); }
      else if (mapOnly) setMapOnly(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [menu, showViewSettings, mapOnly]);
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
        const query = { nodeId: listNodeId, offset, limit: 100, metric, pattern: filter.pattern, kind: filter.kind,
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
  }, [scanId, nodeId, listNodeId, metric, offset, filter, progress.phase, expanded]);

  async function start() {
    if (!root.trim() || starting || running) return;
    setStarting(true); setError('');
    const currentGeneration = ++generation.current;
    const channel = new Channel<Progress>();
    channel.onmessage = data => { if (generation.current === currentGeneration) setProgress(data); };
    try {
      const id = await invoke<number>('start_scan', { root: root.trim(), onProgress: channel });
      localStorage.setItem('glancespace.recentPath', root.trim());
      setHistory({ ids: [0], index: 0 }); setListNodeId(0); setOffset(0); setSelected(null); setPage(null);
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
    try { const result = await open({ directory: true, multiple: false, title: t('folderDialog') }); if (typeof result === 'string') setRoot(result); }
    catch (e) { setError(String(e)); }
  }
  function drill(node: FsNode) {
    if (node.id < 0 || !node.isDir || node.state === 'skipped') return;
    setHistory(h => navigate(h, node.id)); setListNodeId(node.id); setOffset(0); setSelected(node); setError('');
  }
  const mapItems = useMemo(() => tree?.directory.id === nodeId ? branchItems(tree) : [], [tree, nodeId]);
  const branches = useMemo(() => new Map(tree?.branches.map(b => [b.directory.id, branchItems(b)]) ?? []), [tree]);
  const allNodes = useMemo(() => tree ? [...tree.items, ...tree.branches.flatMap(b => b.items)] : [], [tree]);
  function mapClick(rect: Rect) {
    const node = rect.node;
    setSelected(node);
    if (node.state !== 'skipped') setListNodeId(node.isDir ? node.id : (node.parent ?? nodeId));
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
  const diagnostic = localizeDiagnostic(error || progress.message || '', language);
  const detailMessage = localizeDiagnostic(selectedNode?.message ?? '', language);
  const phaseLabel = phaseLabels[progress.phase];
  const metricLabel = t(metric);

  return <div className={'app-shell' + (mapOnly ? ' map-only' : '')} data-theme={view.theme} lang={language} style={{ '--font-body': view.font + 'px', '--font-small': (view.font - 2) + 'px' } as CSSProperties}>
    <main className="main">
      <section className="scan-bar" aria-label={t('scanControls')}>
        <strong className="app-name">GlanceSpace</strong>
        <select aria-label={t('fixedDrives')} value="" disabled={running || starting} onChange={e => setRoot(e.target.value)}><option value="">{t('drive')}</option>{drives.map(d => <option key={d} value={d}>{d}</option>)}</select>
        <label className="path-field"><Icon name="folder" /><input aria-label={t('scanFolder')} value={root} disabled={running || starting} onChange={e => setRoot(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && desktop) void start(); }} placeholder={t('pathExample')} /></label>
        <button className="button subtle" onClick={() => void browse()} disabled={!desktop || running || starting}>{t('browse')}</button>
        <button className="button primary scan-action" onClick={() => void start()} disabled={!desktop || running || starting}>{starting ? t('starting') : scanId ? t('rescan') : t('start')} <Icon name="scan" size={16} /></button>
        {running && <><button className="button subtle" disabled={progress.phase === 'cancelling'} onClick={() => void control(progress.phase === 'paused' ? 'resume' : 'pause')}>{progress.phase === 'paused' ? t('resume') : t('pause')}</button><button className="button danger" disabled={progress.phase === 'cancelling'} onClick={() => void control('cancel')}>{t('cancel')}</button></>}
        <span className="scan-status" role="status">{phaseLabel ? t(phaseLabel) : progress.phase}</span>
        <div className="view-settings normal-only" ref={viewSettings}>
          <button className="icon-button" ref={viewButton} aria-label={t('viewSettings')} title={t('viewSettings')} aria-expanded={showViewSettings} onClick={() => setShowViewSettings(open => !open)}><Icon name="view" /></button>
          {showViewSettings && <div className="view-popover" aria-label={t('viewSettings')}>
            <strong>{t('modules')}</strong>
            {moduleKeys.map(key => <label key={key} className={key === 'map' ? 'locked-module' : ''}><input type="checkbox" checked={modules[key]} disabled={key === 'map' || key === 'list' && !modules.map} onChange={() => {
              setView(old => toggleModule(old, key));
            }} />{t(key)}{key === 'map' && <small>{t('alwaysOn')}</small>}</label>)}
            <label className="font-setting">{t('font')}<select value={view.font} onChange={e => setView(old => ({ ...old, font: Number(e.target.value) as FontSize }))}>{fontSizes.map((size, index) => <option key={size} value={size}>{t(fontLabels[index])}</option>)}</select></label>
            <div className="theme-setting" role="group" aria-label={t('theme')}><span>{t('theme')}</span><div className="theme-options">{themes.map(theme => <button key={theme} type="button" aria-pressed={view.theme === theme} className={view.theme === theme ? 'chosen' : ''} onClick={() => setView(old => ({ ...old, theme }))}>{t(theme)}</button>)}</div></div>
            <label className="font-setting">{t('language')}
              <select value={language} onChange={e => setView(old => ({ ...old, language: e.target.value as Language }))}>
                {Object.entries(languageLabels).map(([code, label]) => <option key={code} value={code} lang={code}>{label}</option>)}
              </select>
            </label>
            <button className="button subtle" onClick={() => setView({ ...defaultView, language })}>{t('reset')}</button>
          </div>}
        </div>
      </section>
      {!desktop && <div className="notice normal-only">{t('preview', { command: 'npm run desktop' })}</div>}
      <section className="explorer">
        <div className="explorer-toolbar"><div className="navigation">
          <button aria-label={t('back')} disabled={history.index === 0} onClick={() => { setHistory(h => ({ ...h, index: h.index - 1 })); setOffset(0); }}><Icon name="arrow" size={16} /></button>
          <button aria-label={t('forward')} disabled={history.index === history.ids.length - 1} onClick={() => { setHistory(h => ({ ...h, index: h.index + 1 })); setOffset(0); }}><span className="forward"><Icon name="arrow" size={16} /></span></button>
          <button aria-label={t('scanRoot')} disabled={!page || nodeId === 0} onClick={() => page && drill(page.breadcrumbs[0])}>⌂</button>
        </div><nav className="breadcrumbs" aria-label={t('currentFolder')}>{page ? page.breadcrumbs.map((n, i) => <span key={n.id}>{i > 0 && <i>/</i>}<button title={n.path} onClick={() => drill(n)}>{i === 0 ? n.path : n.name}</button></span>) : <span>{t('chooseFolder')}</span>}</nav>
        <div className="segmented" role="group" aria-label={t('sizeMetric')}><button aria-pressed={metric === 'disk'} className={metric === 'disk' ? 'chosen' : ''} onClick={() => setMetric('disk')}>{t('disk')}</button><button aria-pressed={metric === 'logical'} className={metric === 'logical' ? 'chosen' : ''} onClick={() => setMetric('logical')}>{t('logical')}</button></div>
        <div className="segmented" role="group" aria-label={t('mapMode')}><button aria-pressed={mode === 'expand'} className={mode === 'expand' ? 'chosen' : ''} onClick={() => setMode('expand')}>{t('expand')}</button><button aria-pressed={mode === 'navigate'} className={mode === 'navigate' ? 'chosen' : ''} onClick={() => setMode('navigate')}>{t('navigate')}</button></div>
        <button className="button subtle" aria-pressed={mapOnly} onClick={() => { setMapOnly(v => !v); closeMenu(); }}>{mapOnly ? t('exitMapOnly') : t('mapOnly')}</button></div>
        {(error || progress.message || opening) && <div className="error" role={opening ? 'status' : 'alert'}><span title={diagnostic}>{opening ? t('opening') : diagnostic}</span>{error && <button aria-label={t('dismiss')} onClick={() => setError('')}>×</button>}</div>}
        <div className="visual-row"><div className="map-panel"><div className="panel-caption"><strong>{t('map')}</strong><div className="map-totals" aria-label={t('scanSizes')} title={progress.unknown ? t('unknownDisk', { count: progress.unknown.toLocaleString(language) }) : t('scanTotal')}><span>{t('disk')} <b>{scanId === null ? '—' : (progress.unknown ? '≥ ' : '') + formatBytes(progress.diskSize)}</b></span><span>{t('logical')} <b>{scanId === null ? '—' : formatBytes(progress.logicalSize)}</b></span></div></div><Treemap key={`${scanId}:${nodeId}`} items={mapItems} branches={branches} t={t} metric={metric} fontSize={view.font} selected={selectedNode?.id} onActivate={mapClick} onSelect={setSelected} onContext={context} onCollapse={ids => setExpanded(old => ids.reduce((next, id) => collapseExpanded(next, id, allNodes), old))} /><div className="map-legend"><span>{t('legend', { metric: metricLabel })}</span>{(tree?.truncated || tree?.branches.some(b => b.truncated)) && <span>{t('merged')}</span>}</div></div>
          <aside className="inspector normal-only" hidden={!modules.details} aria-label={t('selectedDetails')}><h2 title={selectedNode?.name}>{selectedNode?.name || t('itemDetails')}</h2>{selectedNode ? <>
            <button className="detail-path" title={t('copyPath', { path: selectedNode.path })} onClick={() => void navigator.clipboard.writeText(selectedNode.path).catch(e => setError(String(e)))}>{selectedNode.path}</button><div className={`state-chip ${selectedNode.complete ? '' : 'warning'}`}>{t(nodeState(selectedNode))}</div>
            <dl><dt>{t('disk')}</dt><dd>{sizeLabel(selectedNode, 'disk')}</dd><dt>{t('logical')}</dt><dd>{sizeLabel(selectedNode, 'logical')}</dd><dt>{t('modified')}</dt><dd>{date(selectedNode.modified)}</dd></dl>
            {selectedNode.message && <p className="detail-message" title={detailMessage}>{detailMessage}</p>}
            {selectedNode.isDir && selectedNode.state !== 'skipped' && selectedNode.id !== nodeId && <button className="button subtle full" onClick={() => drill(selectedNode)}>{t('enterFolder')}</button>}
          </> : <p className="detail-placeholder">{t('detailHint')}</p>}</aside>
        </div>
      </section>
      <section className="list-panel normal-only" aria-label={t('folderList')} hidden={!modules.list}>
        <div className="list-toolbar"><strong>{t('list')} <small>{t('itemCount', { count: (page?.total ?? 0).toLocaleString(language) })}</small></strong><div className="filters">
          <input aria-label={t('filterName')} maxLength={256} value={pattern} onChange={e => setPattern(e.target.value)} placeholder={t('filterPlaceholder')} />
          <select aria-label={t('itemType')} value={filter.kind} onChange={e => { setFilter(f => ({ ...f, kind: e.target.value })); setOffset(0); }}><option value="all">{t('allTypes')}</option><option value="directory">{t('folders')}</option><option value="file">{t('files')}</option></select>
          <input aria-label={t('minSize')} className="number-filter" type="number" min="0" max="1000000000" value={filter.minSize} onChange={e => { setFilter(f => ({ ...f, minSize: e.target.value })); setOffset(0); }} placeholder="≥ MiB" />
          <input aria-label={t('minAge')} className="number-filter" type="number" min="0" max="100000" step="1" value={filter.olderThanDays} onChange={e => { setFilter(f => ({ ...f, olderThanDays: e.target.value })); setOffset(0); }} placeholder={t('minAgePlaceholder')} />
        </div></div>
        <div className="table-wrap"><table><thead><tr><th>{t('name')}</th><th>{t('disk')}{metric === 'disk' && ' ↓'}</th><th>{t('logical')}{metric === 'logical' && ' ↓'}</th><th>{t('modified')}</th><th>{t('status')}</th></tr></thead><tbody>
          {page?.items.map(node => <tr key={node.id} className={selectedNode?.id === node.id ? 'selected-row' : ''} onClick={() => setSelected(node)} onDoubleClick={() => drill(node)} onContextMenu={e => { e.preventDefault(); context(node, e.clientX, e.clientY); }} onKeyDown={e => {
            if (e.key === 'ContextMenu' || e.key === 'F10' && e.shiftKey) { e.preventDefault(); const bounds = e.currentTarget.getBoundingClientRect(); context(node, bounds.left + 30, bounds.top + 24); }
          }}>
            <td><button className="file-name" title={node.path} onClick={() => setSelected(node)} onKeyDown={e => { if (e.key === 'Enter') drill(node); }}><span className={node.isDir ? 'folder-icon' : 'file-icon'}>{node.isDir ? '▣' : '▪'}</span><span>{node.name}</span></button></td><td>{sizeLabel(node, 'disk')}</td><td>{sizeLabel(node, 'logical')}</td><td>{date(node.modified)}</td><td><span className={`table-state ${node.complete ? '' : 'warning'}`}>{t(nodeState(node))}</span></td>
          </tr>)}
          {!page?.items.length && <tr><td colSpan={5} className="table-empty">{scanId === null ? t('listEmpty') : running ? t('listScanning') : t('noMatches')}</td></tr>}
        </tbody></table></div>
        <div className="list-footer"><span>{t('filterNote')}</span><div><button disabled={!page || offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))}>{t('previous')}</button><span>{page?.total ? `${offset + 1}–${Math.min(offset + 100, page.total)} / ${page.total}` : '0 / 0'}</span><button disabled={!page || offset + 100 >= page.total} onClick={() => setOffset(offset + 100)}>{t('next')}</button></div></div>
      </section>
    </main>
    {menu && <ContextMenu key={`${menu.scanId}:${menu.node.id}:${menu.x}:${menu.y}`} target={menu} t={t} onClose={closeMenu} onAction={(action, target) => void external(action, target)} />}
  </div>;
}
