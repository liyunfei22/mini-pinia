/**
 * defineStore —— options 语法的单元测试
 * 覆盖:惰性 state、$state 与 pinia.state 恒等、getter 的 computed 缓存、
 * getter 的 state 参数 / this / 互调、action 的 this 绑定与跨 store、
 * 按需展开(未声明键不可见)、getter 与 state 重名告警、重复 $id 静默复用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, defineStore, disposePinia, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('options 语法 —— 创建与状态', () => {
  it('state 惰性初始化:defineStore 不执行,首次 useStore 执行一次', () => {
    const stateSpy = vi.fn(() => ({ count: 0 }))
    defineStore('lazy1', { state: stateSpy })
    expect(stateSpy).not.toHaveBeenCalled()

    const useStore = defineStore('lazy2', { state: stateSpy })
    useStore()
    expect(stateSpy).toHaveBeenCalledTimes(1)
    useStore() // 已注册在 _s,不再创建
    expect(stateSpy).toHaveBeenCalledTimes(1)
  })

  it('$state 与 pinia.state.value[id] 恒等,读写互通', () => {
    const store = defineStore('s1', {
      state: () => ({ count: 0, nested: { a: 1 } }),
    })()
    expect(store.$state).toBe(pinia.state.value.s1)

    store.count++
    expect(pinia.state.value.s1.count).toBe(1)
    pinia.state.value.s1.nested.a = 5
    expect(store.nested.a).toBe(5)
  })
})

describe('options 语法 —— getter', () => {
  it('getter 用 computed 缓存:同一次依赖只求值一次,变更后惰性重算', () => {
    let runs = 0
    const store = defineStore('g1', {
      state: () => ({ count: 1 }),
      getters: {
        double(state: { count: number }) {
          runs++
          return state.count * 2
        },
      },
    })()
    expect(store.double).toBe(2)
    expect(store.double).toBe(2)
    expect(runs).toBe(1)
    store.count = 3
    expect(store.double).toBe(6)
    expect(runs).toBe(2)
  })

  it('getter 可通过 state 参数或 this 读状态,可访问其他 getter', () => {
    const store = defineStore('g2', {
      state: () => ({ count: 2 }),
      getters: {
        double(state: { count: number }) {
          return state.count * 2
        },
        quad(this: any): number {
          return this.double * 2
        },
      },
    })()
    expect(store.double).toBe(4)
    expect(store.quad).toBe(8)
  })

  it('getter 与 state 重名时 dev 告警(官方 R1002)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      defineStore('g3', {
        state: () => ({ count: 0 }),
        getters: {
          count(state: { count: number }) {
            return state.count * 2
          },
        },
      })()
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0][0])).toContain('A getter cannot have the same name as another state property')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('options 语法 —— action', () => {
  it('action 的 this 是 store,可互相调用、跨 store 调用', () => {
    const useA = defineStore('a1', {
      state: () => ({ n: 1 }),
      actions: {
        add(this: any, x: number) {
          this.n += x
        },
      },
    })
    const useB = defineStore('b1', {
      state: () => ({ m: 0 }),
      actions: {
        pull(this: any) {
          this.m = useA().n
        },
      },
    })
    const a = useA()
    const b = useB()
    a.add(4)
    expect(a.n).toBe(5)
    b.pull()
    expect(b.m).toBe(5)
  })
})

describe('options 语法 —— 按需展开', () => {
  it('未声明键不可见:store 上读不到($patch 新增键也只存在于 $state)', () => {
    const store = defineStore('e1', { state: () => ({ count: 0 }) })()
    // $patch 新增键 → 进 $state 仓库,但 store 上不动态展开
    store.$patch({ brandNew: 1 } as any)
    expect(pinia.state.value.e1.brandNew).toBe(1)
    expect((store as any).brandNew).toBeUndefined()
    // store 上的临时属性也不会回流进 $state
    ;(store as any).temp = 'x'
    expect(pinia.state.value.e1.temp).toBeUndefined()
  })
})

describe('defineStore —— 重复 id', () => {
  it('同 id 重复 defineStore:静默复用首个实例(官方实测行为,不抛错)', () => {
    const useA = defineStore('dup', { state: () => ({ count: 1 }) })
    const useB = defineStore('dup', { state: () => ({ count: 99 }) })
    const a = useA()
    a.count = 7
    const b = useB()
    expect(b).toBe(a)
    expect(b.count).toBe(7) // 第二个定义没有重置状态
  })
})

describe('defineStore —— 无 pinia 环境', () => {
  it('没有 active pinia 时 useStore 抛错(提示 app.use(pinia))', () => {
    setActivePinia(undefined)
    const useStore = defineStore('noPinia', { state: () => ({}) })
    expect(() => useStore()).toThrow(/no active Pinia/)
  })
})