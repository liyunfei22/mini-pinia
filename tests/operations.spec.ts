/**
 * operations —— 操作 API($patch/$reset/$subscribe/$onAction/$dispose)深度测试
 * 覆盖事件序列与时序语义;行为基准来自 scripts/probes.mjs 对官方 4.1.0 的 31 条探测
 * (单事件广播、flush 时序、args 共享、state 保留等均为「官方实测」结论)。
 * 组件相关场景(卸载自动解绑、flush post)用 @vue/test-utils mount 补测。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createApp, defineComponent, effectScope, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, defineStore, disposePinia, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('$patch —— 两形态与事件序列', () => {
  it('对象形式:恰 1 次同步 patch object 事件(带 payload),watcher 不补发', async () => {
    const store = defineStore('ops1', { state: () => ({ count: 0, nested: { a: 1 } }) })()
    const events: string[] = []
    const hasPayload: boolean[] = []
    store.$subscribe((m: any) => {
      events.push(m.type)
      hasPayload.push('payload' in m)
    })
    store.$patch({ count: 5, nested: { b: 2 } as any }) // 嵌套新键在类型层被官方同样拒绝,运行期合法 → as any

    expect(events).toEqual(['patch object'])
    expect(hasPayload).toEqual([true])
    // 深合并:兄弟键 a 保留、新键 b 出现;顶层 count 覆盖
    expect(store.nested.a).toBe(1)
    expect((store.nested as any).b).toBe(2)
    expect(store.count).toBe(5)

    // activeListener 门控:等一轮微任务也不会有 watcher 补发的 direct 事件
    await nextTick()
    expect(events).toEqual(['patch object'])
  })

  it('函数形式:mutator 直接改 state,恰 1 次同步 patch function 事件(无 payload)', () => {
    const store = defineStore('ops2', { state: () => ({ count: 0 }) })()
    const events: string[] = []
    const hasPayload: boolean[] = []
    store.$subscribe((m: any) => {
      events.push(m.type)
      hasPayload.push('payload' in m)
    })
    store.$patch((s: any) => {
      s.count = 7
    })
    expect(events).toEqual(['patch function'])
    expect(hasPayload).toEqual([false])
    expect(store.count).toBe(7)
  })

  it('事件载荷键:storeId/type/events 齐全;对象形式带 payload', () => {
    const store = defineStore('ops3', { state: () => ({ count: 0 }) })()
    const keysByType: Record<string, string[]> = {}
    // 用 sync flush 让三种事件都在同步段触发(direct 默认是异步的)
    store.$subscribe((m: any) => {
      keysByType[m.type] = Object.keys(m).sort()
    }, { flush: 'sync' })
    store.count = 1
    store.$patch({ count: 2 })
    store.$reset()
    expect(keysByType['direct']).toEqual(['events', 'storeId', 'type'])
    expect(keysByType['patch object']).toEqual(['events', 'payload', 'storeId', 'type'])
    expect(keysByType['patch function']).toEqual(['events', 'storeId', 'type'])
  })

  it('多次 $patch 各自广播一次(原子事件,不合并)', () => {
    const store = defineStore('ops4', { state: () => ({ count: 0 }) })()
    const events: string[] = []
    store.$subscribe((m: any) => events.push(m.type))
    store.$patch({ count: 1 })
    store.$patch({ count: 2 })
    store.$patch((s: any) => s.count++)
    expect(events).toEqual(['patch object', 'patch object', 'patch function'])
    expect(store.count).toBe(3)
  })
})

describe('$reset', () => {
  it('复原全部状态(含嵌套),仅 1 次 patch function 事件', () => {
    const store = defineStore('ops5', {
      state: () => ({ count: 1, nested: { a: 1 }, list: [1] }),
    })()
    const events: string[] = []
    store.$subscribe((m: any) => events.push(m.type))
    store.count = 42
    store.nested.a = 99
    store.list.push(2)
    store.$reset()
    expect(store.count).toBe(1)
    expect(store.nested.a).toBe(1)
    expect(store.list).toEqual([1])
    expect(events).toEqual(['patch function'])
  })
})

describe('$subscribe —— 时序与范围', () => {
  it('默认 flush(pre):直接变更同步 0 次,nextTick 后恰 1 次 direct', async () => {
    const store = defineStore('ops6', { state: () => ({ count: 0 }) })()
    const events: string[] = []
    store.$subscribe((m: any) => events.push(m.type))
    store.count++
    expect(events).toEqual([])
    await nextTick()
    expect(events).toEqual(['direct'])
  })

  it('flush:sync:直接变更立即触发;patch 时不双发', async () => {
    const store = defineStore('ops7', { state: () => ({ count: 0 }) })()
    const events: string[] = []
    store.$subscribe((m: any) => events.push(m.type), { flush: 'sync' })
    store.count++
    expect(events).toEqual(['direct'])
    store.$patch({ count: 9 })
    expect(events).toEqual(['direct', 'patch object'])
    await nextTick()
    expect(events).toEqual(['direct', 'patch object'])
  })

  it('deep 默认开启:嵌套对象变更也触发', async () => {
    const store = defineStore('ops8', { state: () => ({ nested: { a: 1 } }) })()
    const events: string[] = []
    store.$subscribe((m: any) => events.push(m.type))
    store.nested.a = 2
    await nextTick()
    expect(events).toEqual(['direct'])
  })

  it('退订:停 watcher、幂等、不影响其他订阅者', async () => {
    const store = defineStore('ops9', { state: () => ({ count: 0 }) })()
    const log: string[] = []
    const unsub1 = store.$subscribe(() => log.push('a'))
    const unsub2 = store.$subscribe(() => log.push('b'))
    unsub1()
    unsub1()
    store.count++
    await nextTick()
    expect(log).toEqual(['b'])
    unsub2()
    store.count++
    await nextTick()
    expect(log).toEqual(['b'])
  })

  it('重复注册同一回调:告警 + 返回 noop(官方 R1007)', () => {
    const store = defineStore('ops10', { state: () => ({ count: 0 }) })()
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cb = () => {}
      const first = store.$subscribe(cb)
      const second = store.$subscribe(cb)
      expect(typeof second).toBe('function')
      expect(first).not.toBe(second) // 第二次是 noop
      second()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('more than once')
    } finally {
      spy.mockRestore()
    }
  })

  it('detached:effectScope 停止后仍存活;默认订阅被移除', () => {
    const useStore = defineStore('ops11', { state: () => ({ count: 0 }) })
    const rootScope = effectScope(true)
    const log: string[] = []
    rootScope.run(() => {
      const store = useStore()
      store.$subscribe(() => log.push('normal'))
      store.$subscribe(() => log.push('detached'), { detached: true })
    })
    rootScope.stop()
    useStore().$patch({ count: 1 })
    expect(log).toEqual(['detached'])
  })

  it('组件卸载后默认订阅自动解绑;detached 存活(组件版)', async () => {
    const app = createApp({ render: () => null })
    app.use(pinia)
    const useStore = defineStore('ops12', { state: () => ({ count: 0 }) })
    const log: string[] = []
    let store: any = null
    const Comp = defineComponent({
      setup() {
        store = useStore()
        store.$subscribe(() => log.push('normal'))
        store.$subscribe(() => log.push('detached'), { detached: true })
        return () => null
      },
    })
    const wrapper = mount(Comp, { global: { plugins: [pinia] } })
    store.count++
    await nextTick()
    expect(log).toEqual(['normal', 'detached'])

    wrapper.unmount() // 组件卸载 → 非 detached 订阅随 onScopeDispose 移除并停 watcher
    store.count++
    await nextTick()
    // normal 不再触发;detached 是 detached 的,继续触发(官方语义:不随卸载解绑)
    expect(log).toEqual(['normal', 'detached', 'detached'])
  })

  it('flush:post:订阅在组件渲染之后触发', async () => {
    const app = createApp({ render: () => null })
    app.use(pinia)
    const useStore = defineStore('ops13', { state: () => ({ count: 0 }) })
    const log: string[] = []
    let store: any = null
    const Comp = defineComponent({
      setup() {
        store = useStore()
        store.$subscribe(() => log.push('post'), { flush: 'post' })
        // 渲染依赖 store.count:订阅要等这次重渲染完成才触发
        return () => String(store.count)
      },
    })
    mount(Comp, { global: { plugins: [pinia] } })
    store.count++
    expect(log).toEqual([])
    await nextTick()
    expect(log).toEqual(['post'])
  })
})

describe('$onAction', () => {
  it('载荷 {args, name, store, after, onError}', () => {
    const store = defineStore('ops14', {
      state: () => ({ n: 0 }),
      actions: {
        inc(this: any, step = 1) {
          this.n += step
          return this.n
        },
      },
    })()
    let ctx: any = null
    store.$onAction((c) => {
      ctx = c
    })
    store.inc(2)
    expect(ctx.name).toBe('inc')
    expect(ctx.args).toEqual([2])
    expect(ctx.store).toBe(store)
    expect(typeof ctx.after).toBe('function')
    expect(typeof ctx.onError).toBe('function')
  })

  it('同步 action:after 同步触发并拿到返回值;抛错 → onError 并 rethrow', () => {
    const store = defineStore('ops15', {
      actions: {
        sync() {
          return 7
        },
        boom() {
          throw new Error('boom')
        },
      },
    })()
    const log: string[] = []
    store.$onAction((c) => {
      c.after((r) => log.push('after:' + r))
      c.onError((e) => log.push('onError:' + e.message))
    })
    expect(store.sync()).toBe(7)
    expect(log).toEqual(['after:7'])
    expect(() => store.boom()).toThrow('boom')
    expect(log).toEqual(['after:7', 'onError:boom'])
  })

  it('异步 action:resolve → after;reject → onError 并原样 re-reject', async () => {
    const store = defineStore('ops16', {
      actions: {
        async ok() {
          return 9
        },
        async bad() {
          throw new Error('async-boom')
        },
      },
    })()
    const log: string[] = []
    store.$onAction((c) => {
      c.after((r) => log.push('after:' + r))
      c.onError((e) => log.push('onError:' + e.message))
    })
    await store.ok()
    expect(log).toEqual(['after:9'])
    let caught: any = null
    try {
      await store.bad()
    } catch (e) {
      caught = e
    }
    expect(caught?.message).toBe('async-boom')
    expect(log).toEqual(['after:9', 'onError:async-boom'])
  })

  it('args 与 action 共享同一数组(hook 修改对 action 实参可见,官方实测)', () => {
    const store = defineStore('ops17', {
      actions: {
        echo(x: number) {
          return x
        },
      },
    })()
    store.$onAction((c) => {
      c.args[0] = 999
    })
    expect(store.echo(1)).toBe(999)
  })

  it('多个 hook 按注册顺序触发', () => {
    const store = defineStore('ops18', {
      actions: {
        act() {
          return 'r'
        },
      },
    })()
    const log: string[] = []
    store.$onAction((c) => c.after(() => log.push('h1')))
    store.$onAction((c) => c.after(() => log.push('h2')))
    store.act()
    expect(log).toEqual(['h1', 'h2'])
  })

  it('detached:effectScope 停止后 $onAction 默认订阅移除、detached 存活', () => {
    const useStore = defineStore('ops19', {
      actions: { fire() {} },
    })
    const rootScope = effectScope(true)
    const log: string[] = []
    rootScope.run(() => {
      const store = useStore()
      store.$onAction(() => log.push('normal'))
      store.$onAction(() => log.push('detached'), true)
    })
    rootScope.stop()
    useStore().fire()
    expect(log).toEqual(['detached'])
  })
})

describe('$dispose', () => {
  it('停 scope/清订阅/_s 摘除;state 保留;二次调用无害', () => {
    const store = defineStore('ops20', { state: () => ({ count: 1 }) })()
    const events: string[] = []
    store.$subscribe(() => events.push('e'))
    store.count = 5
    store.$dispose()
    expect(pinia._s.has('ops20')).toBe(false)
    expect(pinia.state.value.ops20.count).toBe(5) // state 不删
    store.$dispose() // 二次调用无害
    expect(events).toEqual([]) // dispose 不算变更
  })

  it('dispose 后重建同 id:旧状态保留、state() 不重跑、订阅是新实例的', () => {
    let stateRuns = 0
    const useStore = defineStore('ops21', {
      state: () => {
        stateRuns++
        return { count: 1 }
      },
    })
    const s1 = useStore()
    s1.count = 5
    s1.$dispose()
    const s2 = useStore()
    expect(s2.count).toBe(5)
    expect(stateRuns).toBe(1)
    const events: string[] = []
    s2.$subscribe(() => events.push('e'))
    s2.count++
    expect(events).toEqual([]) // 默认 flush:等 nextTick
  })

  it('对「已被替换的旧实例」$dispose:告警(R1008)并摘除新 store', () => {
    const useStore = defineStore('ops22', { state: () => ({ count: 0 }) })
    const s1 = useStore()
    s1.$dispose()
    useStore() // 重建(同 id)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      s1.$dispose() // 对旧实例再 dispose
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('old instance')
      expect(pinia._s.has('ops22')).toBe(false) // 连新 store 一起被摘除
    } finally {
      spy.mockRestore()
    }
  })
})