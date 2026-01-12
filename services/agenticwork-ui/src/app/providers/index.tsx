import React from 'react';
import { AuthProvider } from './AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { MCPProvider } from './MCPContext';

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers wrapper
 * Composes all context providers in the correct order
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <AuthProvider>
      <ThemeProvider>
        <MCPProvider>
          {children}
        </MCPProvider>
      </ThemeProvider>
    </AuthProvider>
  );
};

export { AuthContext } from './AuthContext';
export { useTheme } from '@/contexts/ThemeContext';
export { MCPContext } from './MCPContext';