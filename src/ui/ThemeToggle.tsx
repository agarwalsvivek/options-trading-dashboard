import { setUi, useUi, type ThemePreference } from '../state/uiStore.ts';

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const ICON: Record<ThemePreference, string> = { system: '◐', light: '☀', dark: '☾' };

// Cycles system -> light -> dark
export function ThemeToggle() {
  const theme = useUi((s) => s.theme);

  return (
    <button
      type="button"
      className="button"
      onClick={() => setUi({ theme: NEXT[theme] })}
      aria-label={`Theme: ${LABEL[theme]}. Switch to ${LABEL[NEXT[theme]]}`}
      title={`Theme: ${LABEL[theme]}`}
    >
      <span aria-hidden="true">{ICON[theme]}</span> {LABEL[theme]}
    </button>
  );
}
