/**
 * createPinia —— pinia 实例工厂与安装
 * 对应官方:packages/pinia/src/createPinia.ts(4.1:837-880)
 * 教学点:
 * 1. 根级 effectScope(true):detached 作用域,不随任何组件卸载而停止 ——
 *    pinia 的生命周期与 app 绑在一起,而不是与某个组件绑在一起;
 * 2. state = ref({}) 也建在 scope 内:disposePinia 停 scope 时响应式依赖一并清理;
 * 3. install 做三件事:setActivePinia、provide(piniaSymbol, pinia)、
 *    app.config.globalProperties.$pinia —— 组件内外两条取用路径的源头;
 * 4. use() 在 install 之前注册 → 先进 toBeInstalled 队列,install 时统一转入 _p
 *    (探测实测:install 前创建的 store 看不到队列里的插件 —— 见 docs/06);
 * 5. markRaw 防止 pinia 实例被意外响应式化。
 * 简化点:官方在 install 时还会自动注册 devtools 插件(对照表第 1 条)。
 */
import { effectScope, markRaw, ref } from 'vue'
import type { App } from 'vue'
import { piniaSymbol, setActivePinia } from './rootStore'
import type { Pinia, PiniaPlugin, StateTree } from './types'

/** 创建 pinia 实例 */
export function createPinia(): Pinia {
  const scope = effectScope(true)
  // state 建在 scope 内:scope.stop() 时其响应式副作用一并停止
  const state = scope.run(() => ref<Record<string, StateTree>>({}))!

  let _p: PiniaPlugin[] = []
  let toBeInstalled: PiniaPlugin[] = []

  // 显式标注 Pinia:让 install/use 方法与 _a/_s 等字段获得上下文类型
  // (否则 `_a: null` 会被推断成字面量 null,install 里赋 app 会报错)
  const pinia: Pinia = markRaw({
    install(app: App) {
      setActivePinia(pinia)
      pinia._a = app
      app.provide(piniaSymbol, pinia)
      // Options-API 的入口:组件里 this.$pinia / mapXxx 依赖这个全局属性
      // 注意:官方 pinia.d.ts 用 `declare module '@vue/runtime-core'` 把
      // ComponentCustomProperties.$pinia 增强成「官方 Pinia」类型;测试程序里
      // 两套声明并存会在此类型撞车 → as any(运行期无差异,见 docs/06)
      ;(app.config.globalProperties as any).$pinia = pinia
      // 队列迁移:install 前 use() 的插件此刻统一进 _p
      toBeInstalled.forEach((plugin) => _p.push(plugin))
      toBeInstalled = []
    },
    use(plugin: PiniaPlugin) {
      // 未 install(_a 为空)先排队;已 install 直接进 _p —— 官方实测行为
      if (!this._a) toBeInstalled.push(plugin)
      else _p.push(plugin)
      return this
    },
    _p,
    _a: null,
    _e: scope,
    _s: /* @__PURE__ */ new Map(),
    state,
  })

  return pinia
}

/**
 * 销毁 pinia:停 effectScope、清空 store 注册表/插件列表/state。
 * 官方主要供测试使用;销毁后该实例不可再用于创建 store。
 */
export function disposePinia(pinia: Pinia): void {
  pinia._e.stop()
  pinia._s.clear()
  pinia._p.splice(0)
  pinia.state.value = {}
  pinia._a = null
}