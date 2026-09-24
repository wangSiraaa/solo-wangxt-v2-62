import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// glpk.js 需要把它打包出来的 .wasm 作为独立资源按原始文件名加载
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['glpk.js'],
  },
  build: {
    target: 'es2022',
  },
});
