import React, { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext();

// Accent color presets - ROYGBIV rainbow order
export const accentColors = [
  { name: 'Red', primary: '#FF3B30', secondary: '#FF453A', lava1: '#FF3B30', lava2: '#FF6961' },       // R - Red
  { name: 'Orange', primary: '#FF9500', secondary: '#FF9F0A', lava1: '#FF9500', lava2: '#FFB340' },    // O - Orange
  { name: 'Yellow', primary: '#FFCC00', secondary: '#FFD60A', lava1: '#FFCC00', lava2: '#FFE066' },    // Y - Yellow
  { name: 'Green', primary: '#34C759', secondary: '#30D158', lava1: '#34C759', lava2: '#4CD964' },     // G - Green
  { name: 'Blue', primary: '#007AFF', secondary: '#0A84FF', lava1: '#007AFF', lava2: '#5AC8FA' },      // B - Blue
  { name: 'Indigo', primary: '#5856D6', secondary: '#6366F1', lava1: '#5856D6', lava2: '#818CF8' },    // I - Indigo
  { name: 'Violet', primary: '#AF52DE', secondary: '#BF5AF2', lava1: '#AF52DE', lava2: '#C77DFF' },    // V - Violet
];

export const themes = {
  dark: {
    // Primary colors - Apple Blue default
    primary: 'var(--user-accent-primary, #0A84FF)',
    secondary: 'var(--user-accent-secondary, #64D2FF)',
    accent: 'var(--user-accent-color, #FF9F0A)',
    success: '#30D158',       // Apple Green
    warning: '#FF9F0A',       // Apple Orange
    error: '#FF453A',         // Apple Red

    // Dark theme backgrounds - solid, macOS-style
    background: '#000000',
    surface: '#1C1C1E',
    surfaceHover: '#2C2C2E',

    // Text hierarchy - Apple dark mode
    text: '#FFFFFF',
    textSecondary: '#EBEBF5',
    textMuted: '#8E8E93',
    textDisabled: '#636366',

    // Borders - subtle
    border: 'rgba(255, 255, 255, 0.08)',
    borderHover: 'rgba(255, 255, 255, 0.15)',

    // Effects - no blur by default
    shadow: '0 2px 8px rgba(0, 0, 0, 0.3)',

    // NO purple-blue gradient - use solid color
    gradientPrimary: 'var(--user-accent-primary, #0A84FF)',
    gradientSecondary: 'var(--user-accent-secondary, #64D2FF)',
    gradientDark: 'linear-gradient(180deg, #000000 0%, #1C1C1E 100%)',

    // Status colors - Apple palette
    statusHealthy: '#30D158',
    statusWarning: '#FF9F0A',
    statusError: '#FF453A',
    statusUnknown: '#8E8E93',
  },
  light: {
    // Light theme - Apple Blue default
    primary: 'var(--user-accent-primary, #007AFF)',  // Apple Blue for light mode
    secondary: 'var(--user-accent-secondary, #5AC8FA)',
    accent: 'var(--user-accent-color, #FF9500)',
    success: '#34C759',       // Apple Green for light
    warning: '#FF9500',       // Apple Orange for light
    error: '#FF3B30',         // Apple Red for light

    // Clean white backgrounds - macOS-style
    background: '#FFFFFF',
    surface: '#F2F2F7',
    surfaceHover: '#E5E5EA',

    // Text hierarchy - Apple light mode
    text: '#000000',
    textSecondary: '#3C3C43',
    textMuted: '#8E8E93',
    textDisabled: '#AEAEB2',

    border: 'rgba(0, 0, 0, 0.08)',
    borderHover: 'rgba(0, 0, 0, 0.15)',

    shadow: '0 2px 8px rgba(0, 0, 0, 0.1)',

    // NO purple-blue gradient - use solid color
    gradientPrimary: 'var(--user-accent-primary, #007AFF)',
    gradientSecondary: 'var(--user-accent-secondary, #5AC8FA)',
    gradientDark: 'linear-gradient(180deg, #FFFFFF 0%, #F2F2F7 100%)',

    statusHealthy: '#34C759',
    statusWarning: '#FF9500',
    statusError: '#FF3B30',
    statusUnknown: '#8E8E93',
  }
};

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Initialize from localStorage or default to 'dark'
    if (typeof window !== 'undefined') {
      return localStorage.getItem('ac-theme') || 'dark';
    }
    return 'dark';
  });
  const [resolvedTheme, setResolvedTheme] = useState('dark');
  const [accentColor, setAccentColor] = useState(() => {
    // Initialize accent color from localStorage
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ac-accent-color');
      return saved ? JSON.parse(saved) : accentColors[0]; // Default to purple
    }
    return accentColors[0];
  });
  // Background effect: 'off' | 'css'
  // 'css' = lightweight CSS-only Liquid Glass effect
  // Note: 'webgl' has been deprecated in favor of CSS for better performance
  const [backgroundEffect, setBackgroundEffectState] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ac-background-effect');
      // Migrate webgl users to css (Liquid Glass replacement)
      if (saved === 'webgl') {
        localStorage.setItem('ac-background-effect', 'css');
        return 'css';
      }
      if (saved) return saved;
      // Backwards compatibility: check old boolean setting
      const oldSaved = localStorage.getItem('ac-background-animations');
      if (oldSaved !== null) {
        const wasEnabled = JSON.parse(oldSaved);
        return wasEnabled ? 'css' : 'off';
      }
      return 'css'; // Default to CSS (lightweight)
    }
    return 'css';
  });

  // Backwards compatibility alias
  const backgroundAnimations = backgroundEffect !== 'off';

  // Function to get system theme preference
  const getSystemTheme = () => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  };

  // Apply accent color to CSS variables
  const applyAccentColor = (accent) => {
    const root = document.documentElement;
    root.style.setProperty('--user-accent-primary', accent.primary);
    root.style.setProperty('--user-accent-secondary', accent.secondary);
    root.style.setProperty('--user-accent-color', accent.primary);
    root.style.setProperty('--lava-color-1', accent.lava1);
    root.style.setProperty('--lava-color-2', accent.lava2);

    // Save to localStorage
    localStorage.setItem('ac-accent-color', JSON.stringify(accent));
    // console.log('Accent color applied:', accent.name);
  };

  // Apply theme to CSS variables
  const applyTheme = (themeName) => {
    const root = document.documentElement;
    const themeConfig = themes[themeName];

    // Apply all theme variables
    Object.entries(themeConfig).forEach(([key, value]) => {
      const cssVarName = `--color-${key}`;
      root.style.setProperty(cssVarName, value);
    });

    // Set data attribute for additional styling hooks
    root.setAttribute('data-theme', themeName);

    // Add/remove 'dark' class for Tailwind dark mode
    if (themeName === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Apply theme class to body
    document.body.className = `${themeName}-theme`;

    // console.log('Theme applied:', themeName);
  };

  // Apply theme and accent color immediately on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('ac-theme') || 'dark';
    let actualTheme = savedTheme;

    if (savedTheme === 'system') {
      actualTheme = getSystemTheme();
    }

    setTheme(savedTheme);
    setResolvedTheme(actualTheme);
    applyTheme(actualTheme);

    // Apply saved accent color
    applyAccentColor(accentColor);
  }, []);

  // Handle theme changes
  useEffect(() => {
    let actualTheme = theme;

    if (theme === 'system') {
      actualTheme = getSystemTheme();

      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = (e) => {
        const newTheme = e.matches ? 'dark' : 'light';
        setResolvedTheme(newTheme);
        applyTheme(newTheme);
      };

      mediaQuery.addEventListener('change', handleChange);

      return () => {
        mediaQuery.removeEventListener('change', handleChange);
      };
    }

    setResolvedTheme(actualTheme);
    applyTheme(actualTheme);
    localStorage.setItem('ac-theme', theme);
  }, [theme]);

  const changeTheme = (newTheme) => {
    setTheme(newTheme);
  };

  const changeAccentColor = (newAccent) => {
    // console.log('Changing accent color to:', newAccent.name);
    setAccentColor(newAccent);
    applyAccentColor(newAccent);
  };

  // Set background effect: 'off' or 'css'
  const setBackgroundEffect = (effect) => {
    const validEffects = ['off', 'css'];
    const newEffect = validEffects.includes(effect) ? effect : 'css';
    setBackgroundEffectState(newEffect);
    localStorage.setItem('ac-background-effect', newEffect);
  };

  // Toggle background effect: off <-> css
  const toggleBackgroundAnimations = () => {
    const newEffect = backgroundEffect === 'off' ? 'css' : 'off';
    setBackgroundEffect(newEffect);
  };

  const value = {
    theme,
    resolvedTheme,
    changeTheme,
    themes,
    accentColor,
    accentColors,
    changeAccentColor,
    backgroundAnimations, // Backwards compat: true if effect !== 'off'
    backgroundEffect,     // New: 'off' | 'css' | 'webgl'
    setBackgroundEffect,  // New: setter function
    toggleBackgroundAnimations, // Cycles through effects
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};