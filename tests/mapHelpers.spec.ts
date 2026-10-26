/**
 * mapHelpers —— Options-API 辅助(mapState/mapGetters/mapActions/mapWritableState)
 * 单元测试:在真实 Options-API 组件里 mount,验证 this.$pinia 注入链、
 * 数组/对象(键重映射、函数形态)两形态、可写映射与 action 参数透传。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, defineStore, disposePinia, mapActions, mapGetters, mapState, mapWritableState, setActivePinia } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

const useStore = defineStore('mapMain', {
  state: () => ({ count: 1, name: 'a' }),
  getters: {
    double(s: any) {
      return s.count * 2
    },
    nameUpper(s: any) {
      return s.name.toUpperCase()
    },
  },
  actions: {
    incBy(this: any, step = 1) {
      this.count += step
      return this.count
    },
  },
})

function mountMapped(): any {
  const Comp = defineComponent({
    computed: {
      // 数组形态:键名直映
      ...mapState(useStore, ['count', 'double'] as any),
      // 对象形态:键重映射 + 函数形态(以组件为 this,实参是 store)
      ...mapState(useStore, {
        n: 'count',
        doubled: 'double',
        upperName: (store: any) => store.name.toUpperCase(),
      } as any),
      // mapGetters = mapState 别名(数组形态)
      ...mapGetters(useStore, ['double'] as any),
      // 可写映射(键重映射)
      ...mapWritableState(useStore, { writableCount: 'count' } as any),
    },
    methods: {
      // 数组形态
      ...mapActions(useStore, ['incBy'] as any),
      // 对象形态:键重映射
      ...mapActions(useStore, { addTwo: 'incBy' } as any),
    },
    render: () => null,
  })
  return mount(Comp, { global: { plugins: [pinia] } })
}

describe('mapState / mapGetters', () => {
  it('数组形态与对象形态(重映射 + 函数)在 Options-API 组件内生效', async () => {
    const wrapper = mountMapped()
    const vm: any = wrapper.vm
    // 数组形态
    expect(vm.count).toBe(1)
    expect(vm.double).toBe(2)
    // 对象形态:重映射键 + 函数形态
    expect(vm.n).toBe(1)
    expect(vm.doubled).toBe(2)
    expect(vm.upperName).toBe('A')
    // mapGetters 别名
    expect(vm.double).toBe(2)
    // 响应式:store 变更 → 组件 computed 跟随(读取即重算)
    const store = useStore()
    store.count = 5
    await Promise.resolve()
    expect(vm.count).toBe(5)
    expect(vm.double).toBe(10)
    expect(vm.n).toBe(5)
    expect(vm.doubled).toBe(10)
    store.name = 'b'
    expect(vm.upperName).toBe('B')
    wrapper.unmount()
  })
})

describe('mapWritableState', () => {
  it('get/set 双向:组件写 → store 变;store 变 → 组件读', async () => {
    const wrapper = mountMapped()
    const vm: any = wrapper.vm
    expect(vm.writableCount).toBe(1)
    vm.writableCount = 9
    expect(useStore().count).toBe(9)
    useStore().count = 3
    expect(vm.writableCount).toBe(3)
    wrapper.unmount()
  })
})

describe('mapActions', () => {
  it('数组与对象(重映射)形态:参数透传、返回值返回、this 绑定到 store', () => {
    const wrapper = mountMapped()
    const vm: any = wrapper.vm
    expect(vm.incBy(2)).toBe(3) // 1 + 2
    expect(useStore().count).toBe(3)
    expect(vm.addTwo(2)).toBe(5) // 3 + 2,重映射到同一 action
    expect(useStore().count).toBe(5)
    wrapper.unmount()
  })
})