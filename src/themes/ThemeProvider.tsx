import { useEffect, type ReactNode } from 'react';
import { useThemeStore } from '../store/useThemeStore';
import './base.css';
import './classic/classic.css';
import './hud/hud.css';

/**
 * Applies `data-theme` (classic|hud) and `data-mode` (dark|light) to <html>.
 * The two toggles are fully independent → 4 valid visual states.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useThemeStore((s) => s.theme);
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.mode = mode;
    root.style.colorScheme = mode;
  }, [theme, mode]);

  return <>{children}</>;
}
