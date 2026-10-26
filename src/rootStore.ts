/**
 * rootStore —— 模块级「当前 pinia」单例
 * 对应官方:packages/pinia/src/rootStore.ts
 * 教学点:
 * 1. pinia 的定位依赖一个「当前激活 pinia」:SSR 场景每个请求各自的 pinia 由
 *    setActivePinia 显式切换,避免跨请求状态串扰;
 * 2. 组件环境优先走 provide/inject 注入链(install 时 provide(piniaSymbol)),
 *    注入链拿不到才兜底回模块级 activePinia —— 这一行就是 SSR 安全的全部秘密。
 */
import { hasInjectionContext, inject } from 'vue'
import type { Pinia, StoreGeneric } from './types'

/** 模块级单例:当前激活的 pinia(不存在时 undefined);store.ts 内部直接读写 */
export let activePinia: Pinia | undefined

/**
 * 设置/清除当前激活的 pinia。SSR 与内部调用 action/getter 前使用
 * (官方还用于测试隔离:每个用例 setActivePinia(createPinia()))。
 */
export function setActivePinia(pinia: Pinia | undefined): void {
  activePinia = pinia
}

/**
 * 获取当前激活的 pinia:
 * 1. 有组件注入上下文 → 优先取 provide 链上的 pinia(每个 app 注入各自的)
 * 2. 拿不到(非组件环境)→ 回退模块级 activePinia
 * mini 简化:官方 dev 版在「非浏览器环境且拿不到 pinia」时通过诊断码
 * PINIA_R1004 报 console.error,这里直接输出同文案(error 级别)。
 */
export function getActivePinia(): Pinia | undefined {
  const pinia = hasInjectionContext() && (inject(piniaSymbol) as Pinia)
  if (!pinia && typeof window === 'undefined') {
    console.error(
      '[🍍]: Pinia instance not found in context. This falls back to the global ' +
        'activePinia, which exposes you to cross-request pollution on the server. ' +
        'Call "useStore()" at the top of setup() (or another composable), or pass ' +
        'the pinia instance explicitly when used outside of a component.',
    )
  }
  return pinia || activePinia
}

/**
 * 获取某 pinia 上已创建的全部 store(每次返回新数组,迭代期间增/删 store 安全)。
 * 官方 4.x 新增 API,建议用它而不是直接读 pinia._s。
 */
export function getStores(pinia: Pinia): StoreGeneric[] {
  return Array.from(pinia._s.values())
}

/**
 * provide/inject 用的注入键:install 时 app.provide(piniaSymbol, pinia)。
 * 官方在 dev 下带描述、prod 为空 Symbol;mini 统一带描述。
 * @internal
 */
export const piniaSymbol = /* istanbul ignore next */ Symbol('pinia')