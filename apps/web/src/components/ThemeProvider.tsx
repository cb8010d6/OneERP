'use client';

import React, { useEffect, useState } from 'react';
import { useThemeStore } from '../store/themeStore';
import { useI18nStore } from '../lib/i18n';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useThemeStore((state) => state.theme);
  const language = useI18nStore((state) => state.language);
  const hydrateLanguage = useI18nStore((state) => state.hydrateLanguage);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    hydrateLanguage();
  }, [hydrateLanguage]);

  useEffect(() => {
    if (!mounted) return;
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme, mounted]);

  useEffect(() => {
    if (!mounted) return;
    window.document.documentElement.lang = language;
  }, [language, mounted]);

  if (!mounted) {
    return <>{children}</>;
  }

  return <>{children}</>;
}
