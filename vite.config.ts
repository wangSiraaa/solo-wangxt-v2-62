import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 相对 base：build 产物可离线拷贝到任意目录打开
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: {
    format: 'es',
  },
});
