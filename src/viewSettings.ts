import { defaultLanguage } from './i18n.ts';
import type { Language } from './i18n.ts';

export const moduleKeys = ['map', 'list', 'details'] as const;
export type Module = typeof moduleKeys[number];
export const fontSizes = [13, 14, 16] as const;
export type FontSize = typeof fontSizes[number];
export const themes = ['dark', 'light'] as const;
export type Theme = typeof themes[number];
export type ViewSettings = { font: FontSize; theme: Theme; language: Language; modules: Record<Module, boolean> };
export const defaultView: ViewSettings = { font: 14, theme: 'dark', language: defaultLanguage, modules: { map: true, list: true, details: true } };

export function readView(raw: string | null): ViewSettings {
  try {
    const value = JSON.parse(raw ?? 'null');
    const modules = { ...defaultView.modules };
    for (const key of moduleKeys) if (typeof value?.modules?.[key] === 'boolean') modules[key] = value.modules[key];
    modules.map = true;
    const theme = themes.find(item => item === value?.theme) ?? defaultView.theme;
    const language = value?.language === 'en' ? 'en' : defaultLanguage;
    const savedFont = value?.font === 17 ? 16 : value?.font;
    const font = fontSizes.find(size => size === savedFont) ?? defaultView.font;
    return { modules, font, theme, language };
  } catch { return defaultView; }
}

export function toggleModule(view: ViewSettings, key: Module): ViewSettings {
  if (key === 'map') return view;
  const modules = { ...view.modules, [key]: !view.modules[key] };
  return { ...view, modules: { ...modules, map: true } };
}
