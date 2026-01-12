/**
 * @copyright 2005 Agenticwork LLC
 * @license PROPRIETARY
 * 
 * This file is the exclusive property of Agenticwork LLC. All rights reserved.
 * 
 * NOTICE: This source code is proprietary and confidential. It contains trade
 * secrets and proprietary information that is the exclusive property of
 * Agenticwork LLC. Any unauthorized use, reproduction, distribution, or
 * disclosure of this material is strictly prohibited.
 * 
 * No part of this source code may be reproduced, stored in a retrieval system,
 * or transmitted in any form or by any means (electronic, mechanical,
 * photocopying, recording, or otherwise) without the prior written permission
 * of Agenticwork LLC.
 * 
 * This software is provided "as is" without warranty of any kind, either
 * express or implied, including but not limited to the implied warranties of
 * merchantability, fitness for a particular purpose, or non-infringement.
 * 
 * For licensing inquiries, please contact:
 * Agenticwork LLC
 * legal@agenticwork.io
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Serve public folder (includes docs)
  publicDir: 'public',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@/app': path.resolve(__dirname, './src/app'),
      '@/features': path.resolve(__dirname, './src/features'),
      '@/shared': path.resolve(__dirname, './src/shared'),
      '@/api': path.resolve(__dirname, './src/api'),
      '@/lib': path.resolve(__dirname, './src/lib'),
      '@/utils': path.resolve(__dirname, './src/utils'),
      '@/types': path.resolve(__dirname, './src/types'),
      '@/config': path.resolve(__dirname, './src/config'),
      '@/assets': path.resolve(__dirname, './src/assets')
    }
  },
  define: {
    // Environment-specific builds
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  build: {
    // Production optimizations
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production' ? 'terser' : false,
    target: 'esnext',
    cssMinify: true,
    rollupOptions: {
      output: {
        // Enhanced code splitting for better caching
        manualChunks: {
          // Core React ecosystem
          'react-vendor': ['react', 'react-dom'],
          'react-router': ['react-router-dom'],

          // Heavy UI libraries
          'ui-vendor': ['framer-motion'],
          'icons': ['lucide-react'],

          // Chat-specific heavy components (lazy loaded)
          'admin-portal': ['@/features/admin/components/AdminPortal'],
          'image-analysis': ['@/shared/components/ImageAnalysis'],
          'docs-viewer': ['@/features/docs/DocsViewer'],
          'canvas-panel': ['@/shared/components/CanvasPanel']
        },
        // Better file naming for caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
    // Chunk size warnings
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    // Pre-bundle heavy dependencies for faster cold starts
    include: [
      'react-markdown',
      'remark-gfm',
      'framer-motion',
      'lucide-react',
      '@microsoft/msal-react',
      '@microsoft/msal-browser'
    ],
    // Exclude heavy components that are lazy loaded
    exclude: [
      '@/features/admin/components/AdminPortal',
      '@/shared/components/ImageAnalysis',
      '@/features/docs/DocsViewer',
      '@/shared/components/CanvasPanel'
    ],
    esbuildOptions: {
      target: 'esnext',
      // Enable tree shaking
      treeShaking: true
    }
  },
  server: {
    host: true,
    port: 3000,
    // Performance optimizations
    hmr: {
      overlay: false // Disable error overlay for better performance
    },
    // Enable HTTP/2 for development
    https: false, // Can be enabled with certificates
    // Faster file watching
    watch: {
      usePolling: false,
      useFsEvents: true
    },
    // Allow ngrok hosts for development
    allowedHosts: [
      'localhost',
      '.ngrok-free.app',
      '.ngrok.io'
    ],
    proxy: {
      '/api': {
        // Use localhost:8080 for local development (Caddy), or Docker service name inside container
        target: process.env.DOCKER_ENV ? 'http://agenticworkchat-api:8000' : 'http://localhost:8080',
        changeOrigin: true,
        // Note: Don't strip /api prefix - the API server expects routes at /api/*
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/ws': {
        target: process.env.DOCKER_ENV ? 'ws://agenticworkchat-api:8000' : 'ws://localhost:8080',
        ws: true,
        changeOrigin: true,
        // Note: Don't strip /ws prefix - the API server expects routes at /ws/*
        // rewrite: (path) => path.replace(/^\/ws/, '')
      }
    }
  }
})
