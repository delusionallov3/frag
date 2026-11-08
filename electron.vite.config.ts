import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    // Windows réserve parfois le port 5173 (Hyper-V / WSL) : on écoute sur 127.0.0.1 et un autre port
    server: { host: '127.0.0.1', port: 3000, strictPort: false },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
    // two pages: the app, and the motion layer the montage export draws offscreen (src/main/motion.ts)
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          motion: resolve('src/renderer/motion.html'),
        },
      },
    },
  },
});
