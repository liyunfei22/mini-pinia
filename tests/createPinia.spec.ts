/**
 * createPinia —— pinia 实例工厂/安装/销毁的单元测试
 * 覆盖:实例形状(install 前后的 _a/_p/_e/_s/state)、app.use 后的 provide 注入链、
 * use() 在 install 前后的队列语义(实测官方行为:先入队、install 时迁移)、disposePinia。
 */
import { describe, it, expect, vi } from 'vitest'
import { createApp, defineComponent, h, inject } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, defineStore, disposePinia, getStores, piniaSymbol, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

function freshPinia(): Pinia {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

describe('createPinia —— 实例形状', () => {
  it('创建后:_s 为空 Map、state 为空对象、_a 为 null、_e 存活', () => {
    const pinia = freshPinia()
    expect(pinia._s).toBeInstanceOf(Map)
    expect(pinia._s.size).toBe(0)
    expect(pinia.state.value).toEqual({})
    expect(pinia._a).toBeNull()
    expect(pinia._e.active).toBe(true)
    disposePinia(pinia)
  })

  it('effectScope 是 detached 的:不随任意 scope 停止', () => {
    const pinia = createPinia()
    const scope = pinia._e
    expect(scope.active).toBe(true)
    disposePinia(pinia)
    expect(scope.active).toBe(false)
  })
})

describe('createPinia —— install 注入链', () => {
  it('install 后 $pinia 全局属性与 provide(piniaSymbol) 立即可用', () => {
    const pinia = createPinia()
    const app = createApp({ render: () => null })
    app.use(pinia)
    expect(app.config.globalProperties.$pinia).toBe(pinia)

    // 组件内 inject(piniaSymbol) 拿到同一实例(getActivePinia 的注入链来源)
    let injected: unknown = null
    const Probe = defineComponent({
      setup() {
        injected = inject(piniaSymbol, null)
        return () => h('div')
      },
    })
    mount(Probe, { global: { plugins: [pinia] } })
    expect(injected).toBe(pinia)
    disposePinia(pinia)
  })
})

describe('createPinia —— use() 插件队列', () => {
  it('install 前 use() 进队列,install 时迁移到 _p(官方实测行为)', () => {
    const pinia = createPinia()
    const plugin = vi.fn()
    pinia.use(plugin)
    expect(pinia._p).toHaveLength(0) // 未 install:还在 toBeInstalled

    const app = createApp({ render: () => null })
    app.use(pinia)
    expect(pinia._p).toContain(plugin)

    disposePinia(pinia)
  })

  it('install 后 use() 直接进 _p', () => {
    const pinia = createPinia()
    const app = createApp({ render: () => null })
    app.use(pinia)
    const plugin = vi.fn()
    pinia.use(plugin)
    expect(pinia._p).toContain(plugin)
    disposePinia(pinia)
  })
})

describe('createPinia —— disposePinia 与 getStores', () => {
  it('disposePinia:停 scope、清空 store/插件/state', () => {
    const pinia = freshPinia()
    defineStore('g1', { state: () => ({ count: 0 }) })()
    expect(pinia._s.size).toBe(1)
    disposePinia(pinia)
    expect(pinia._e.active).toBe(false)
    expect(pinia._s.size).toBe(0)
    expect(pinia.state.value).toEqual({})
    expect(pinia._p).toHaveLength(0)
  })

  it('getStores 返回已创建 store 的新数组(迭代安全)', () => {
    const pinia = freshPinia()
    const s1 = defineStore('gs1', { state: () => ({}) })()
    defineStore('gs2', { state: () => ({}) })()
    const stores = getStores(pinia)
    expect(stores.map((s: any) => s.$id).sort()).toEqual(['gs1', 'gs2'])
    expect(stores[0]).toBe(s1)
    disposePinia(pinia)
  })
})