import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName = 'classic' | 'hud';
export type ModeName = 'dark' | 'light';

interface ThemeState {
  theme: ThemeName;
  mode: ModeName;
  setTheme: (theme: ThemeName) => void;
  setMode: (mode: ModeName) => void;
  toggleTheme: () => void;
  toggleMode: () => void;
}

/**
 * Two *independent* toggles → four valid visual states.
 * Persisted under `morsecode.theme` and restored before first paint
 * (see the inline bootstrap in `ThemeProvider`).
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'classic',
      mode: 'dark',
      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      toggleTheme: () => set({ theme: get().theme === 'classic' ? 'hud' : 'classic' }),
      toggleMode: () => set({ mode: get().mode === 'dark' ? 'light' : 'dark' }),
    }),
    { name: 'morsecode.theme' },
  ),
);
