import { useEffect } from 'react';
import { useUi, type ThemePreference } from './uiStore.ts';

const darkQuery = () => matchMedia('(prefers-color-scheme: dark)');

function applyTheme(preference: ThemePreference) {
  const mode = preference === 'system' ? (darkQuery().matches ? 'dark' : 'light') : preference;
  // data-theme drives our CSS tokens; data-ag-theme-mode switches AG Grid's colour scheme
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.agThemeMode = mode;
}

// Keeps <html> in sync with the theme preference (and the OS setting while on "system")
export function useThemeSync() {
  const preference = useUi((s) => s.theme);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== 'system') return;

    const query = darkQuery();
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);
}
