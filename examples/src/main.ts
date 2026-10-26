/**
 * demo 入口(M5 完整版):组装应用并挂载
 * 顺序:createApp → pinia.use(loggerPlugin)(install 前调用 → 进待装队列,
 * 由 createPinia 的 install 统一转入 _p)→ app.use(pinia) → mount #app。
 */
import { createApp } from 'vue'
import { createPinia } from '@mini/index'
import { App } from './app'
import { loggerPlugin } from './plugin'

const app = createApp(App)
const pinia = createPinia()

// 注册 logger 插件:每个 store 创建时注入 $createdAt / $pluginId 并打日志
pinia.use(loggerPlugin)

app.use(pinia)
app.mount('#app')