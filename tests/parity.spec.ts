/**
 * parity —— 与官方 pinia 4.1.0 的行为对拍
 * 机制:同一批 store 定义分别交给官方与 mini,pinia 实例互相隔离
 * (各自 createPinia + 各自 setActivePinia),只比「可观察行为」。
 * 若有行为差异,一律以官方为准修复 mini —— 这是本测试文件存在的意义。
 * (M2 子集:创建/展开/缓存/重复 id/dispose 重建;操作 API 的对拍随 M3 补全)
 */
import { describe, it, expect } from 'vitest'
import { computed, ref, reactive } from 'vue'
import {
  createPinia as officialCreatePinia,
  defineStore as officialDefineStore,
  disposePinia as officialDisposePinia,
  setActivePinia as officialSetActivePinia,
} from 'pinia'
import {
  createPinia,
  defineStore,
  disposePinia,
  setActivePinia,
} from '../src/index'

/** 共享的 options 语法 store 定义(纯数据,不依赖任何库) */
const optionStoreDef = () => ({
  state: () => ({ count: 0, list: [1, 2] as number[], nested: { a: 1, b: { c: 2 } } }),
  getters: {
    double: (s: any) => s.count * 2,
    listCount: (s: any) => s.list.length,
  },
  actions: {
    inc(this: any, step = 1) {
      this.count += step
    },
    pushItem(this: any, x: number) {
      this.list.push(x)
    },
  },
})

/** 共享的 setup 语法 store 定义(工厂:每次调用产出独立的 setup 函数) */
const setupStoreDef = () => () => {
  const count = ref(0)
  const list = ref([1, 2] as number[])
  const nested = reactive({ a: 1, b: { c: 2 } })
  const double = computed(() => count.value * 2)
  function inc(this: any, step = 1) {
    this.count += step
  }
  return { count, list, nested, double, inc }
}

/** 双实例工厂:官方与 mini 各自独立 pinia + 隔离的 activePinia(返回 any:对拍文件只比运行行为,不比编译类型) */
function makePair(defId: string, def: () => any, isSetup = false): { o: any; m: any; dispose: () => void } {
  const oPinia = officialCreatePinia()
  const mPinia = createPinia()
  officialSetActivePinia(oPinia)
  const o = isSetup ? officialDefineStore(defId, def())() : officialDefineStore(defId, def())()
  setActivePinia(mPinia)
  const m = isSetup ? defineStore(defId, def())() : defineStore(defId, def())()
  return {
    o,
    m,
    dispose() {
      officialDisposePinia(oPinia)
      disposePinia(mPinia)
    },
  }
}

/** 对比助手:两边同一脚本取值,不一致时把两边结果都 dump 出来 */
function expectSame(label: string, valueOf: (store: any) => any, o: any, m: any) {
  const ov = valueOf(o)
  const mv = valueOf(m)
  const explain = `${label}\n  official: ${JSON.stringify(ov)}\n  mini:     ${JSON.stringify(mv)}`
  expect(mv, explain).toEqual(ov)
}

describe('parity —— 创建与展开', () => {
  it('options 语法:state 与 getter 初始值一致', () => {
    const { o, m, dispose } = makePair('parA', optionStoreDef)
    expectSame('state', (s: any) => JSON.parse(JSON.stringify(s.$state)), o, m)
    expect(m.double).toBe(o.double)
    expect(m.listCount).toBe(o.listCount)
    dispose()
  })

  it('setup 语法:state 与 getter 初始值一致', () => {
    const { o, m, dispose } = makePair('parB', setupStoreDef, true)
    expect(m.count).toBe(o.count)
    expectSame('list', (s: any) => [...s.list], o, m)
    expectSame('nested', (s: any) => ({ a: s.nested.a, b: s.nested.b }), o, m)
    expect(m.double).toBe(o.double)
    dispose()
  })

  it('按需展开:两库都不暴露未声明键,store 引用一致($state 读穿)', () => {
    const { o, m, dispose } = makePair('parC', optionStoreDef)
    ;(o as any).temp = 'x'
    ;(m as any).temp = 'x'
    // 临时属性不上 $state
    expect((o.$state as any).temp).toBeUndefined()
    expect((m.$state as any).temp).toBeUndefined()
    // $state 身份:mini 与官方一致(都是「读穿到 pinia.state」的实现)
    expect((m as any)._p).toBeDefined()
    expect((o as any)._p).toBeDefined()
    dispose()
  })

  it('getter 缓存:同一驱动脚本下,两边副作用计数一致', () => {
    const counter = { o: 0, m: 0 }
    const oPinia = officialCreatePinia()
    const mPinia = createPinia()
    officialSetActivePinia(oPinia)
    const useO = officialDefineStore('parD', {
      state: () => ({ count: 0 }),
      getters: {
        d(s: any) {
          counter.o++
          return s.count
        },
      },
    })
    setActivePinia(mPinia)
    const useM = defineStore('parD', {
      state: () => ({ count: 0 }),
      getters: {
        d(s: any) {
          counter.m++
          return s.count
        },
      },
    })
    const o = useO()
    const m = useM()
    o.d
    m.d
    o.d
    m.d
    o.d
    m.d
    expect(counter.o).toBe(1)
    expect(counter.m).toBe(1)
    o.count = 5
    m.count = 5
    o.d
    m.d
    expect(counter.o).toBe(2)
    expect(counter.m).toBe(2)
    expect(m.d).toBe(o.d)
    officialDisposePinia(oPinia)
    disposePinia(mPinia)
  })
})

describe('parity —— 重复 id 与 dispose 重建', () => {
  it('同 id 重复 defineStore:两边都静默复用首个实例', () => {
    const oPinia = officialCreatePinia()
    const mPinia = createPinia()
    officialSetActivePinia(oPinia)
    const oUseA = officialDefineStore('parE', { state: () => ({ count: 1 }) })
    const oUseB = officialDefineStore('parE', { state: () => ({ count: 99 }) })
    const o1 = oUseA()
    o1.count = 7
    const o2 = oUseB()
    setActivePinia(mPinia)
    const mUseA = defineStore('parE', { state: () => ({ count: 1 }) })
    const mUseB = defineStore('parE', { state: () => ({ count: 99 }) })
    const m1 = mUseA()
    m1.count = 7
    const m2 = mUseB()
    expect(o2).toBe(o1)
    expect(m2).toBe(m1)
    expect(m2.count).toBe(o2.count)
    officialDisposePinia(oPinia)
    disposePinia(mPinia)
  })

  it('$dispose 后重建同 id:两边都保留旧状态,state() 都不重跑', () => {
    const runs = { o: 0, m: 0 }
    const oPinia = officialCreatePinia()
    const mPinia = createPinia()
    officialSetActivePinia(oPinia)
    const useO = officialDefineStore('parF', {
      state: () => {
        runs.o++
        return { count: 1 }
      },
    })
    const o1 = useO()
    o1.count = 5
    o1.$dispose()
    const o2 = useO()
    setActivePinia(mPinia)
    const useM = defineStore('parF', {
      state: () => {
        runs.m++
        return { count: 1 }
      },
    })
    const m1 = useM()
    m1.count = 5
    m1.$dispose()
    const m2 = useM()
    expect(o2.count).toBe(5)
    expect(m2.count).toBe(5)
    expect(runs.o).toBe(1)
    expect(runs.m).toBe(1)
    officialDisposePinia(oPinia)
    disposePinia(mPinia)
  })
})