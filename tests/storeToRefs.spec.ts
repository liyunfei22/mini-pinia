/**
 * storeToRefs —— 从 store 提取可解构引用的单元测试
 * 覆盖:ref/reactive/computed/函数/普通值/插件 ref 的分类、解构后双向同步、
 * options 语法 getter 同样可收编、解构保持响应性的教学场景。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, computed, reactive, ref } from 'vue'
import { createPinia, defineStore, disposePinia, setActivePinia, storeToRefs } from '../src/index'
import type { Pinia } from '../src/types'

let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => disposePinia(pinia))

describe('storeToRefs —— 四分类', () => {
  it('ref→ref、reactive→ref、computed→computed ref;函数跳过;双向同步', () => {
    const useStore = defineStore('str1', () => {
      const count = ref(1)
      const user = reactive({ name: 'a' })
      const double = computed(() => count.value * 2)
      function inc() {}
      return { count, user, double, inc }
    })
    const store = useStore()
    const refs = storeToRefs(store)

    expect(refs.count).toBeDefined()
    expect(refs.user).toBeDefined()
    expect(refs.double).toBeDefined()
    expect('inc' in refs).toBe(false) // action 函数跳过
    expect(Object.keys(refs).sort()).toEqual(['count', 'double', 'user'])

    // store → refs
    store.count = 5
    expect(refs.count.value).toBe(5)
    expect(refs.double.value).toBe(10)
    store.user.name = 'b'
    expect(refs.user.value.name).toBe('b')

    // refs → store(反向写回)
    refs.count.value = 9
    expect(store.count).toBe(9)
    expect(store.double).toBe(18)
  })

  it('解构后保持响应性(storeToRefs 存在的意义)', () => {
    const useStore = defineStore('str2', { state: () => ({ count: 1 }) })
    const store = useStore()
    const { count } = storeToRefs(store)
    store.count = 3
    expect(count.value).toBe(3)
    count.value = 7
    expect(store.count).toBe(7)
  })

  it('options 语法的 getter 同样被收编(computed 检测走 value?.effect)', () => {
    const useStore = defineStore('str3', {
      state: () => ({ n: 2 }),
      getters: {
        dbl(s: { n: number }) {
          return s.n * 2
        },
      },
    })
    const store = useStore()
    const refs = storeToRefs(store)
    expect(refs.dbl.value).toBe(4)
    store.n = 5
    expect(refs.dbl.value).toBe(10) // 惰性重算后跟随
  })

  it('setup store 里的普通非响应式值被跳过(不产生 refs)', () => {
    const useStore = defineStore('str4', () => {
      const count = ref(0)
      const tag = 'plain'
      return { count, tag }
    })
    const store = useStore()
    const refs = storeToRefs(store)
    expect('tag' in refs).toBe(false)
    expect(refs.count).toBeDefined()
  })

  it('插件加的 ref 也收编(它们同样挂在 store 上)', () => {
    // install 后 use() 才直进 _p(官方实测语义,见 plugins.spec)
    const app = createApp({ render: () => null })
    app.use(pinia)
    pinia.use(() => ({ $extra: ref(1) }))
    const store = defineStore('str5', { state: () => ({ count: 0 }) })()
    const refs = storeToRefs(store)
    expect(refs.$extra.value).toBe(1)
    refs.$extra.value = 9
    expect((store as any).$extra).toBe(9)
  })
})