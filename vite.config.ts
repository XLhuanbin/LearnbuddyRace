import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2500,
    // 本环境的删除操作受安全策略限制，无法清空输出目录；
    // 因此使用稳定的文件名，重复构建直接覆盖，避免产生遗留的旧哈希文件。
    emptyOutDir: false,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/chunk-[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
