/**
 * plugins —— 插件系统的单元测试
 * 覆盖:store 创建时执行、ctx 四件套(store/app/pinia/options,且 options.actions
 * 是原始函数)、扩展值铺到 store(ref 解包)、后注册插件不回溯、toBeInstalled 队列。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, ref } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
let app: ReturnType<typeof createApp>
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  // 注意(官方实测行为):install 之前 use() 只进 toBeInstalled 队列,
  // 插件不会在 store 创建时执行 —— 所以测试装置统一先 app.use(pinia)
  app = createApp({ render: () => null })
  app.use(pinia)
})
afterEach(() => disposePinia(pinia))

describe('插件系统 —— 上下文与执行时机', () => {
  it('store 创建时执行,ctx 四件套正确且 options.actions 是原始函数', () => {
    let ctx: any = null
    pinia.use((c) => {
      ctx = c
    })
    const useStore = defineStore('pl1', {
      state: () => ({ count: 0 }),
      actions: {
        inc(this: any) {
          this.count++
        },
      },
    })
    const store = useStore()
    expect(ctx.store).toBe(store)
    expect(ctx.pinia).toBe(pinia)
    expect(ctx.app).toBe(app)
    // options.actions 是「原始」函数(包装发生在程序内部,插件永远看不到 wrapper)
    expect(ctx.options.actions.inc.name).toBe('inc')
    expect(typeof ctx.options.actions.inc).toBe('function')
  })

  it('use() 在 app.use 前注册:install 时才转入 _p(官方实测行为)', () => {
    const pinia2 = createPinia()
    const plugin = vi.fn()
    pinia2.use(plugin)
    expect(pinia2._p).toHaveLength(0) // toBeInstalled 队列
    const app2 = createApp({ render: () => null })
    app2.use(pinia2)
    expect(pinia2._p).toContain(plugin)
    disposePinia(pinia2)
  })
})

describe('插件系统 —— 返回值扩展', () => {
  it('扩展对象铺到 store,ref 自动解包', () => {
    pinia.use(() => ({ $plugged: 'yes', counter: ref(10) }))
    const store: any = defineStore('pl2', { state: () => ({ count: 0 }) })()
    expect(store.$plugged).toBe('yes')
    expect(store.counter).toBe(10)
    expect(store._customProperties.has('$plugged')).toBe(true)
  })

  it('store 创建后注册的插件不回溯:旧 store 无扩展,新 store 有', () => {
    const s1: any = defineStore('pl3', { state: () => ({ count: 0 }) })()
    const ran: string[] = []
    pinia.use((c) => {
      ran.push((c.store as any).$id)
      return { $late: 'x' }
    })
    const s2: any = defineStore('pl4', { state: () => ({}) })()
    expect(ran).toEqual(['pl4']) // 只在之后的 store 创建时执行
    expect(s1.$late).toBeUndefined() // 旧 store 未被回溯扩展
    expect(s2.$late).toBe('x')
  })
})