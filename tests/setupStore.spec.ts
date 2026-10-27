/**
 * setupStore —— setup 语法(组合式)的单元测试
 * 覆盖:ref/reactive/computed 的三分发、state 仓库里存 ref 本体(store 上解包)、
 * action 包装($onAction 感知 + this 绑定)、computed 记入 _getters、
 * 预置 state 的 hydration(SSR 场景)、$reset 抛错、空 state store。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { computed, isRef, reactive, ref, toRaw } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('setup 语法 —— 状态分发', () => {
  it('state 分发:仓库里存 ref 本体,store/$state 上解包读取', () => {
    const useStore = defineStore('su1', () => {
      const count = ref(1)
      const user = reactive({ name: 'a' })
      return { count, user }
    })
    const store = useStore()

    expect(store.count).toBe(1)
    expect(store.user.name).toBe('a')

    // 仓库里存的是 ref 本体(token 化:直接改 ref.value 也能反映到 store)
    const raw = toRaw(pinia.state.value.su1)
    expect(isRef(raw.count)).toBe(true)
    expect(raw.count.value).toBe(1)

    store.user.name = 'b'
    expect(toRaw(raw.user).name).toBe('b')
  })

  it('computed 成为 getter:缓存求值 + 记入 _getters', () => {
    let runs = 0
    const useStore = defineStore('su2', () => {
      const count = ref(1)
      const double = computed(() => {
        runs++
        return count.value * 2
      })
      return { count, double }
    })
    const store = useStore()
    expect(store.double).toBe(2)
    expect(store.double).toBe(2)
    expect(runs).toBe(1)
    store.count = 3
    expect(store.double).toBe(6)
    expect(runs).toBe(2)
    expect((store as any)._getters).toContain('double')
  })

  it('预置 pinia.state 后创建的 setup store:初始值被 hydration(SSR 场景)', () => {
    pinia.state.value.su3 = { count: 5 }
    const useStore = defineStore('su3', () => ({
      count: ref(0),
      nested: reactive({ a: 1 }),
    }))
    const store = useStore()
    expect(store.count).toBe(5)
    expect(store.nested.a).toBe(1)
  })

  it('无 state 的 setup store:$state 始终为空对象', () => {
    const useStore = defineStore('su4', () => ({
      who: () => 'x',
    }))
    const store = useStore()
    expect(pinia.state.value.su4).toBeDefined()
    expect(store.$state).toEqual({})
    expect(store.who()).toBe('x')
  })
})

describe('setup 语法 —— action', () => {
  it('action 被 wrapAction:this 是 store,$onAction 能感知', () => {
    const useStore = defineStore('su5', () => {
      const count = ref(0)
      function inc(this: any, step = 1) {
        this.count += step
      }
      return { count, inc }
    })
    const store = useStore()
    store.inc(2)
    expect(store.count).toBe(2)

    const seen: string[] = []
    store.$onAction((c) => seen.push(c.name))
    store.inc(1)
    expect(seen).toEqual(['inc'])
  })

  it('setup 语法 $reset 抛错(官方行为:只有 options store 有 $reset)', () => {
    const store = defineStore('su6', () => ({ count: ref(0) }))()
    expect(() => store.$reset()).toThrow(/setup syntax/)
  })

  it('setup 语法下 $patch/$state 赋值:改写仓库里的 ref 本体与 reactive(官方语义)', () => {
    const useStore = defineStore('su7', () => {
      const count = ref(1)
      const nested = reactive({ a: 1 })
      return { count, nested }
    })
    const store = useStore()
    const raw = toRaw(pinia.state.value.su7)
    const refBefore = raw.count
    const nestedBefore = raw.nested

    // 对象 $patch:仓库里的 ref 本体被「就地改写」而非替换 —— reactive set trap
    // 在旧值是 ref、新值非 ref 时走 oldValue.value = newValue(官方同款,Vue 行为)
    store.$patch({ count: 5 })
    expect(store.count).toBe(5)
    expect(store.$state.count).toBe(5)
    expect(raw.count).toBe(refBefore) // 仍是同一个 ref 本体
    expect(refBefore.value).toBe(5) // 其 value 已被改写

    // 嵌套 reactive 走深合并,原位发生(raw 层身份保留,差分实验双库一致)
    store.$patch({ nested: { b: 2 } as any })
    expect(store.nested.a).toBe(1)
    expect((store.nested as any).b).toBe(2)
    expect(toRaw(pinia.state.value.su7.nested)).toBe(nestedBefore)

    // $state 赋值同样走 $patch(官方同款 setter 语义)
    store.$state = { count: 9, nested: { a: 1, b: 2 } } as any
    expect(store.count).toBe(9)
  })
})