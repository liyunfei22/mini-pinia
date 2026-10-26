/**
 * stores —— demo 用两个 store(全应用共用同一份单例)
 * 1. useCounterStore(options 语法):演示 state / getters / actions、
 *    getter 缓存(double 每次「真正重算」都计数,读缓存不计数)、$reset、$patch、
 *    $subscribe、$onAction(含故意失败与异步 action 的 after 时序);
 * 2. useCartStore(setup 语法):ref / computed 直写,checkout() 内部跨 store 调
 *    useCounterStore().inc() —— 演示 wrapAction 开头 setActivePinia,让跨 store
 *    取用在非组件上下文(actions 内部)也能成立。
 * 纪律:examples/ 内只 import 'vue' 与 '@mini/index',绝不 import 'pinia'。
 */
import { computed, ref } from 'vue'
import { defineStore } from '@mini/index'
import type { _GettersTree } from '@mini/index'

// ---------------------------------------------------------------------------
// getter 缓存可视化:double 被「真正求值」的次数(模块级计数器,命中缓存不递增)
// ---------------------------------------------------------------------------
let doubleEvalCount = 0
/** 读取 double getter 的累计求值次数(供面板 ② 显示;非响应式,但只在 count 变时变) */
export function getDoubleEvalCount(): number {
  return doubleEvalCount
}

// ---------------------------------------------------------------------------
// ① useCounterStore —— options 语法
// 说明:mini-pinia 的骨架泛型对「options 对象字面量」的 S/G/A 推断较弱(与官方
// d.ts 体操有差距),所以这里显式写明类型实参 —— 既保证推导,也顺便把 store
// 形状文档化;其中 fail 声明为 () => never,是让动作树保留在 Store 类型上的关键
// (任何返回具体类型的动作树都不会被 _ActionsTree extends A 分支吞掉)。
// ---------------------------------------------------------------------------
export interface CounterState {
  count: number
  title: string
  history: string[]
}
export interface CounterGetters extends _GettersTree<CounterState> {
  double: (state: CounterState) => number
}
export interface CounterActions {
  inc: (step?: number) => number
  fail: () => never
  slowInc: (step?: number) => Promise<number>
}

export const useCounterStore = defineStore<
  'counter',
  CounterState,
  CounterGetters,
  CounterActions
>('counter', {
  state: (): CounterState => ({
    count: 0,
    title: '计数器',
    /** 操作历史(数组 state,演示 $reset 复原) */
    history: [],
  }),
  getters: {
    /**
     * double:每次「真正重算」都会 ++ 模块级计数;若 computed 命中缓存则
     * 根本不会执行到这里 —— 这就是「getter 缓存可视化」的依据。
     */
    double(state) {
      doubleEvalCount += 1
      return state.count * 2
    },
  },
  actions: {
    /** 普通同步 action:改 count 并记历史($onAction 的 after 拿到返回值) */
    inc(step = 1) {
      this.count += step
      this.history.push(
        `${new Date().toLocaleTimeString('zh-CN')} +${step}`,
      )
      return this.count
    },
    /** 故意抛错:演示 $onAction.onError(错误会被原样继续向外抛) */
    fail() {
      throw new Error('故意失败:counter.fail() —— 错误已被 onError 观察')
    },
    /** 异步 action:延迟后 inc,演示 after 要在 Promise 落定后才触发(时序) */
    async slowInc(step = 2) {
      await new Promise((resolve) => setTimeout(resolve, 600))
      this.inc(step)
      return this.count
    },
  },
})

// ---------------------------------------------------------------------------
// ② useCartStore —— setup 语法
// ---------------------------------------------------------------------------
export interface CartItem {
  name: string
  price: number
  qty: number
}

export const useCartStore = defineStore('cart', () => {
  /** state:ref 数组(setup 语法里状态就是普通 ref / computed) */
  const items = ref<CartItem[]>([
    { name: '香蕉', price: 3, qty: 2 },
    { name: '笔记本', price: 100, qty: 1 },
  ])
  /** getter:computed 总价 */
  const total = computed(() =>
    items.value.reduce((sum, it) => sum + it.price * it.qty, 0),
  )

  /** action:加购一件 */
  function addItem() {
    items.value.push({
      name: `商品${items.value.length + 1}`,
      price: 10 + items.value.length * 5,
      qty: 1,
    })
  }

  /**
   * action:跨 store 调用 counter.inc()。wrapped action 开头会 setActivePinia,
   * 因此这里 useCounterStore() 能拿到同一个 pinia 实例(演示跨 store action);
   * counter.$onAction 层面也会「额外」记录这次 inc 调用。
   */
  function checkout() {
    const counter = useCounterStore()
    counter.inc(items.value.length)
    return `checkout 完成:共 ${items.value.length} 件,计数器 +${items.value.length}`
  }

  /** action:故意抛错(演示 setup 语法 store 的 onError) */
  function fail() {
    throw new Error('故意失败:cart.fail() —— 错误已被 onError 观察')
  }

  return { items, total, addItem, checkout, fail }
})