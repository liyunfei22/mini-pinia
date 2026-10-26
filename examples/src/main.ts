/**
 * demo 入口(M1 占位版 —— M5 里程碑替换为完整教学 demo)
 * 说明:让 npm run dev 从 M1 起即可启动。
 */
import { createApp, h } from 'vue'

createApp({
  render: () =>
    h(
      'div',
      {
        style: 'padding: 24px; font-family: monospace; font-size: 13px;',
      },
      'mini-pinia demo(M1 占位页 —— 完整 demo 随 M5 里程碑落地)',
    ),
}).mount('#app')