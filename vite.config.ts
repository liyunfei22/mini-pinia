import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// 单页 demo:入口为根目录 index.html(挂载 examples/src/main.ts)
// 库产物由 tsc 出到 dist/(tsconfig.build.json),demo 产物独立到 dist-demo/
export default defineConfig({
  resolve: {
    alias: {
      '@mini': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-demo',
  },
})