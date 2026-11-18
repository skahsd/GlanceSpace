export const moduleLabels = { map: '空间矩阵', list: '目录内容', details: '详情' };
export type Module = keyof typeof moduleLabels;
export const moduleKeys = Object.keys(moduleLabels) as Module[];
export const fontSizes = [14, 15, 16, 17] as const;
export type FontSize = typeof fontSizes[number];
export type ViewSettings = { font: FontSize; modules: Record<Module, boolean> };
export const defaultView: ViewSettings = { font: 15, modules: { map: true, list: true, details: true } };

export function readView(raw: string | null): ViewSettings {
  try {
    const value = JSON.parse(raw ?? 'null');
    const modules = { ...defaultView.modules };
    for (const key of moduleKeys) if (typeof value?.modules?.[key] === 'boolean') modules[key] = value.modules[key];
    if (!modules.map && !modules.list) modules.map = true;
    return { modules, font: fontSizes.find(size => size === value?.font) ?? defaultView.font };
  } catch { return defaultView; }
}

export function toggleModule(view: ViewSettings, key: Module): ViewSettings {
  const modules = { ...view.modules, [key]: !view.modules[key] };
  return modules.map || modules.list ? { ...view, modules } : view;
}
