/**
 * Electron preload bridge — the only API the renderer is allowed to see.
 *
 * Deliberately tiny: no Node primitives, no fs, no process handle. Just three static
 * fields so the tukuk-os web UI can branch on `window.tukukDesktop.isDesktop` to show
 * desktop-only affordances (native menu hints, keyboard accelerators, custom titlebar).
 * Any future capability must be added here explicitly via `contextBridge` — never by
 * turning `nodeIntegration` back on.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('tukukDesktop', {
  platform: process.platform,
  isDesktop: true,
  version: process.versions.electron || 'unknown'
});
