/**
 * Global type definitions
 */

interface Window {
  showNotification?: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}