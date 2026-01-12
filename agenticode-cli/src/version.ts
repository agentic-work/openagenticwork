/**
 * Version utility - reads version from package.json
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

let cachedVersion: string = '';

export function getVersion(): string {
  if (cachedVersion) return cachedVersion;

  try {
    // Try multiple paths to find package.json
    const possiblePaths = [
      // In container: /app/agenticode/package.json
      '/app/agenticode/package.json',
      // Relative to dist/version.js
      join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
      // Relative to src/version.ts (dev mode)
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
    ];

    for (const pkgPath of possiblePaths) {
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        cachedVersion = pkg.version || 'unknown';
        return cachedVersion;
      }
    }
  } catch (err) {
    // Fallback if we can't read package.json
    console.error('Could not read version from package.json:', err);
  }

  cachedVersion = 'unknown';
  return cachedVersion;
}
