/**
 * store —— mini-pinia 核心:defineStore 与两种语法的创建管线
 * 对应官方:packages/pinia/src/store.ts(4.1:969-1381;mapHelpers/storeToRefs 见各文件)
 * 教学点:
 * 1. 归一:options 语法在 createOptionsStore 里被「翻译」成 setup(state→toRefs、
 *    getters→computed、actions 原样),之后两条语法共用同一条 createSetupStore 管线;
 * 2. 按需展开:store 以 reactive({ _customProperties, ...partialStore }) 诞生并登记进
 *    pinia._s(先于 setup 执行,getter 才能自引用 store);setupStore 的键经三分发
 *    (ref/reactive→状态、function→action、computed→getter)后双写
 *    assign(store, setupStore) + assign(toRaw(store), setupStore) —— 只摊开声明过的键;
 * 3. $state 是 defineProperty 的读穿桥:get 直通 pinia.state.value[id],set 走 $patch;
 * 4. 订阅全部挂在 Set 上(addSubscription/triggerSubscriptions);
 *    $patch 用 isListening/isSyncListening/activeListener 三变量门控只广播一次;
 * 5. action 经 wrapAction:this 永远落回自己的 store、args 共享、异步 then/catch 分流。
 * 简化点(见 docs/06):无 HMR(_hotUpdate/_hmrPayload/useStore._pinia)、
 * 无 skipHydrate/shouldHydrate、dev/prod 分支合一(一律 dev 行为)、告警用 console。
 */
import {
  computed,
  effectScope,
  hasInjectionContext,
  inject,
  isReactive,
  isRef,
  markRaw,
  nextTick,
  reactive,
  toRaw,
  toRefs,
  watch,
} from 'vue'
import type { EffectScope } from 'vue'
import { addSubscription, triggerSubscriptions } from './subscriptions'
import { activePinia, piniaSymbol, setActivePinia } from './rootStore'
import { isComputed, mergeReactiveObjects, noop } from './utils'
import type {
  _ActionsTree,
  _GettersTree,
  DefineSetupStoreOptions,
  DefineStoreOptions,
  Pinia,
  PiniaPlugin,
  SetupStoreDefinition,
  SetupStoreHelpers,
  StateTree,
  StoreDefinition,
  SubscriptionCallback,
} from './types'

const { assign } = Object

/** 浏览器判定(官方 env.ts;dev 分支行为的基础) */
const IS_CLIENT = typeof window !== 'undefined'
/** 兜底:app 没有 runWithContext(vue <3.5)时直接执行 */
const fallbackRunWithContext = (fn: () => any) => fn()

/** wrapAction 的标记与名字:已包装的 action 再次包装只更新名字(官方同款) */
const ACTION_MARKER = Symbol()
const ACTION_NAME = Symbol()

// ---------------------------------------------------------------------------
// defineStore:两种调用形态的公共入口
// ---------------------------------------------------------------------------

export function defineStore<
  Id extends string,
  S extends StateTree = {},
  G extends _GettersTree<S> = {},
  A = _ActionsTree,
>(
  id: Id,
  options: Omit<DefineStoreOptions<Id, S, G, A>, 'id'>,
): StoreDefinition<Id, S, G, A>
export function defineStore<Id extends string, SS>(
  id: Id,
  storeSetup: (helpers: SetupStoreHelpers) => SS,
  options?: DefineSetupStoreOptions<Id>,
): SetupStoreDefinition<Id, SS>
export function defineStore(id: string, setup: any, setupOptions?: any): any {
  // setup 是函数 → setup 语法(第三参为 options);否则 options 语法
  let options: any
  const isSetupStore = typeof setup === 'function'
  options = isSetupStore ? setupOptions : setup

  function useStore(pinia?: Pinia | null): any {
    const hasContext = hasInjectionContext()
    // 取 pinia 的顺序:显式传入 → 组件注入链 → 模块级 activePinia(见下)
    pinia = pinia || (hasContext ? (inject(piniaSymbol, null) as Pinia | null) : null)
    if (pinia) setActivePinia(pinia)
    if (!activePinia) {
      // 官方 dev 守卫:忘装 pinia 时给出可执行的提示(prod 版本此分支被裁剪)
      throw new Error(
        '[🍍]: "getActivePinia()" was called but there was no active Pinia. Are you trying to use a store before calling "app.use(pinia)"?\n' +
          'See https://pinia.vuejs.org/core-concepts/outside-component-usage.html for help.\n' +
          'This will fail in production.',
      )
    }
    pinia = activePinia

    // 惰性创建:首次 useStore 才真正建 store;重复 defineStore 同 id 直接复用首个
    if (!pinia._s.has(id)) {
      if (isSetupStore) createSetupStore(id, setup, options, pinia)
      else createOptionsStore(id, options, pinia)
    }

    const store = pinia._s.get(id)
    return store
  }
  useStore.$id = id

  return useStore
}

// ---------------------------------------------------------------------------
// options 语法:在创建的一瞬间被「翻译」成 setup
// ---------------------------------------------------------------------------

function createOptionsStore(id: string, options: any, pinia: Pinia): any {
  const { state, actions, getters } = options
  const initialState = pinia.state.value[id]
  let store: any

  function setup(): Record<string, any> {
    // 首次创建才执行 state()(重建场景 initialState 已在 → 旧状态保留)
    if (!initialState) {
      pinia.state.value[id] = state ? state() : {}
    }
    const localState = toRefs(pinia.state.value[id])
    return assign(
      localState,
      actions,
      // getters → computed:缓存与惰性重算的前提;求值前 setActivePinia,
      // 保证异步 action 里跨 store 读 getter 时 activePinia 正确
      Object.keys(getters || {}).reduce((computedGetters: any, name) => {
        if (name in localState) {
          // 官方 R1002:getter 不能与 state 重名
          console.warn(
            `[🍍]: A getter cannot have the same name as another state property. Found "${name}" in store "${id}".`,
          )
        }
        computedGetters[name] = markRaw(
          computed(() => {
            setActivePinia(pinia)
            const store = pinia._s.get(id)
            // getter 的 this 与第一个实参都是整个 store(官方:getters[name].call(store, store))
            return getters[name].call(store, store)
          }),
        )
        return computedGetters
      }, {}),
    )
  }

  store = createSetupStore(id, setup, options, pinia, true)
  return store
}

// ---------------------------------------------------------------------------
// createSetupStore:两种语法的共同管线(状态/action/getter 的分发与全部 $ 方法)
// ---------------------------------------------------------------------------

function createSetupStore(
  $id: string,
  setup: (helpers: SetupStoreHelpers) => Record<string, any>,
  options: any,
  pinia: Pinia,
  isOptionsStore = false,
): any {
  let scope: EffectScope | undefined
  // 插件上下文里的 options:actions 放「原始」函数(包装前的)
  const optionsForPlugin = assign({ actions: {} }, options)

  if (!pinia._e.active) throw new Error('Pinia destroyed')

  // $subscribe 的默认选项:deep 深度监听;dev 下用 onTrigger 捕获调试事件
  // (直接变更 = 单条事件,patch 中 = 聚合为数组,事件载荷 events 字段的来源)
  const $subscribeOptions: { deep: boolean; onTrigger?: (event: any) => void } = {
    deep: true,
  }
  $subscribeOptions.onTrigger = (event) => {
    if (isListening) debuggerEvents = event
    else if (isListening === false) {
      if (Array.isArray(debuggerEvents)) debuggerEvents.push(event)
      else console.error('🍍 debuggerEvents should be an array. This is most likely an internal Pinia bug.')
    }
  }

  // 三门控:patch 广播时暂停 watcher(直接变更),nextTick 后再恢复
  let isListening = false
  let isSyncListening = false
  let debuggerEvents: any

  const subscriptions = new Set<SubscriptionCallback<any>>()
  const actionSubscriptions = new Set<(ctx: any) => void>()

  // setup 语法且无历史状态:先把空对象注册进 state 仓库($state 始终有值)
  const initialState = pinia.state.value[$id]
  if (!isOptionsStore && !initialState) {
    pinia.state.value[$id] = {}
  }

  let activeListener: symbol

  // $patch(对象/函数两形态):合并后只广播「一次」同步 patch 事件
  function $patch(partialStateOrMutator: any) {
    let subscriptionMutation: any
    isListening = isSyncListening = false
    debuggerEvents = []
    if (typeof partialStateOrMutator === 'function') {
      partialStateOrMutator(pinia.state.value[$id])
      subscriptionMutation = { type: 'patch function', storeId: $id, events: debuggerEvents }
    } else {
      mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator)
      subscriptionMutation = { type: 'patch object', payload: partialStateOrMutator, storeId: $id, events: debuggerEvents }
    }
    // activeListener 门控:只有「自己」发起的 patch 才能在 nextTick 后恢复 isListening,
    // 避免嵌套 patch 提前恢复导致 watcher 补发 direct 事件
    const myListenerId = (activeListener = Symbol() as symbol)
    nextTick().then(() => {
      if (activeListener === myListenerId) isListening = true
    })
    isSyncListening = true
    triggerSubscriptions(subscriptions, subscriptionMutation, pinia.state.value[$id])
  }

  // $reset:options 语法 = 用初始 state 做一次函数形态 $patch(单条 patch function 事件);
  // setup 语法 dev 抛错(官方行为)
  const $reset = isOptionsStore
    ? function $reset(this: any) {
        const { state } = options
        const newState = state ? state() : {}
        this.$patch(($state: any) => {
          assign($state, newState)
        })
      }
    : () => {
        throw new Error(
          `[🍍]: Store "${$id}" is built using the setup syntax and does not implement $reset().`,
        )
      }

  // $dispose:停 scope(连带 watcher/effect)、清订阅、从 _s 摘除;
  // 注意:不删 pinia.state.value[$id](重建同 id store 时旧状态保留)
  function $dispose() {
    scope?.stop()
    subscriptions.clear()
    actionSubscriptions.clear()
    // 官方 R1008:对「旧实例」调 $dispose 会连新 store 一起摘掉,给出提醒
    const registeredStore = pinia._s.get($id)
    if (registeredStore && registeredStore !== store) {
      console.warn(
        `[🍍]: "$dispose()" was called on an old instance of store "${$id}" that has already been replaced by a new one. This also removes the new store.`,
      )
    }
    pinia._s.delete($id)
  }

  // wrapAction:action 的统一包装
  //  - 开头 setActivePinia:异步 action 里跨 store 取用时「当前 pinia」正确;
  //  - this 绑定:this.$id 是自己的 store 才用 this,否则一律落回自己的 store;
  //  - args 是调用时快照,与 action 共享同一数组;
  //  - 同步/异步分流:after 拿返回值,onError 拿错误(异步原样 re-reject)
  const action = (fn: any, name = '') => {
    if (ACTION_MARKER in fn) {
      fn[ACTION_NAME] = name
      return fn
    }
    const wrappedAction = function (this: any, ...args: any[]) {
      setActivePinia(pinia)
      const afterCallbackSet = new Set<(value: any) => void>()
      const onErrorCallbackSet = new Set<(error: any) => void>()
      function after(callback: (value: any) => void) {
        afterCallbackSet.add(callback)
      }
      function onError(callback: (error: any) => void) {
        onErrorCallbackSet.add(callback)
      }
      triggerSubscriptions(actionSubscriptions, {
        args,
        name: wrappedAction[ACTION_NAME],
        store,
        after,
        onError,
      })
      let ret: any
      try {
        ret = fn.apply(this && this.$id === $id ? this : store, args)
      } catch (error) {
        triggerSubscriptions(onErrorCallbackSet, error)
        throw error
      }
      if (ret instanceof Promise) {
        return ret
          .then((value) => {
            triggerSubscriptions(afterCallbackSet, value)
            return value
          })
          .catch((error) => {
            triggerSubscriptions(onErrorCallbackSet, error)
            return Promise.reject(error)
          })
      }
      triggerSubscriptions(afterCallbackSet, ret)
      return ret
    }
    wrappedAction[ACTION_MARKER] = true
    wrappedAction[ACTION_NAME] = name
    return wrappedAction
  }

  // store 的「骨架」:$ 方法 + 内部字段挂在这里(_p 指向 pinia 实例)
  const partialStore = {
    _p: pinia,
    $id,
    $onAction: addSubscription.bind(null, actionSubscriptions),
    $patch,
    $reset,
    $subscribe(callback: SubscriptionCallback<any>, options: any = {}) {
      // Set 天然去重:同一回调重复注册,告警并返回 noop(官方 R1007)
      if (subscriptions.has(callback)) {
        console.warn(
          `[🍍]: The same callback was passed to "$subscribe()" of store "${$id}" more than once. Subscriptions are deduplicated, so the duplicate is ignored.`,
        )
        return noop
      }
      // watcher 随订阅移除而停止(removeSubscription 的 onCleanup)
      const removeSubscription = addSubscription(subscriptions, callback, !!options.detached, () => stopWatcher())
      const stopWatcher = scope!.run(() =>
        watch(
          () => pinia.state.value[$id],
          (state) => {
            // 直接变更走 watcher:sync flush 用 isSyncListening,默认(pre)用 isListening;
            // patch 是同步广播,不经过这里(activeListener 门控保证不双发)
            if (options.flush === 'sync' ? isSyncListening : isListening) {
              callback({ storeId: $id, type: 'direct', events: debuggerEvents }, state)
            }
          },
          assign({}, $subscribeOptions, options),
        ),
      )!
      return removeSubscription
    },
    $dispose,
  }

  // 按需展开第一步:store = reactive(骨架),并先登记进 _s(setup 里可自引用)
  const store: any = reactive(
    assign(
      {
        _customProperties: markRaw(new Set()), // 插件扩展键名单(教学:跟踪扩展来源)
      },
      partialStore,
    ),
  )
  pinia._s.set($id, store)

  // setup 在嵌套 scope 里执行:pinia 根 scope(detached)→ store scope → 组件/调用方
  // (runWithContext 让 app 的 provide 上下文在 setup 期间可用)
  const setupStore: Record<string, any> =
    ((pinia._a && (pinia._a as any).runWithContext) || fallbackRunWithContext)(() =>
      pinia._e.run(() => (scope = effectScope()).run(() => setup({ action }))),
    )

  // 按需展开第二步:setupStore 的键三分发
  for (const key in setupStore) {
    const prop = setupStore[key]

    // 1) 状态分支:ref(非 computed)或 reactive → 进 state 仓库
    if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
      if (!isOptionsStore) {
        // setup 语法:SSR 预置 state 存在时做 hydration(把初始值灌进 ref/响应式对象),
        // 再把 ref 本体存进仓库(store.$state 读的就是这份数据)
        if (initialState) {
          if (isRef(prop)) prop.value = initialState[key]
          else {
            if (prop instanceof Set || prop instanceof Map) prop.clear()
            mergeReactiveObjects(prop, initialState[key])
          }
        }
        pinia.state.value[$id][key] = prop
      }
      // options 语法:state 已由 createOptionsStore 以 toRefs 注册完成,这里跳过
    } else if (typeof prop === 'function') {
      // 2) action 分支:套 wrapAction($onAction 可感知、this 绑定、异步分流)
      setupStore[key] = action(prop, key)
      optionsForPlugin.actions[key] = prop // 插件拿到的是原始函数
    } else if (isComputed(prop)) {
      // 3) getter 分支:记录 getter 名单(教学/调试用,官方仅 dev 浏览器环境)
      if (IS_CLIENT) (setupStore._getters || (setupStore._getters = markRaw([]))).push(key)
    }
  }

  // 按需展开第三步:双写(响应式代理层 + toRaw 原始层,保证遍历/toRaw 都可见)
  assign(store, setupStore)
  assign(toRaw(store), setupStore)

  // $state 读穿桥:get 直通 pinia.state.value[id],set 走 $patch
  Object.defineProperty(store, '$state', {
    get: () => pinia.state.value[$id],
    set: (state: any) => {
      $patch(($state: any) => {
        assign($state, state)
      })
    },
  })

  // 插件:在 store 自己的 scope 里执行,上下文四件套,返回值铺到 store
  pinia._p.forEach((extender: PiniaPlugin) => {
    const extensions = scope!.run(
      () => extender({ store, app: pinia._a as any, pinia, options: optionsForPlugin }),
    ) as Record<string, any> | undefined
    if (extensions) {
      Object.keys(extensions).forEach((key) => (store._customProperties as Set<string>).add(key))
      // dev 提示:非响应式对象扩展会被 storeToRefs 忽略(官方 R1006)
      for (const key in extensions) {
        const value = extensions[key]
        if (
          typeof value === 'object' &&
          !isRef(value) &&
          !isReactive(value) &&
          !(value as any)?.__v_skip
        ) {
          console.warn(
            `[🍍]: Property "${key}" of store "${$id}" is not reactive (not a ref, reactive object, or shallowRef), so it will not be picked up by storeToRefs().`,
          )
        }
      }
    }
    assign(store, extensions)
  })

  // 官方 R1003:state 必须是纯对象(class 实例会被警告)
  if (
    store.$state &&
    typeof store.$state === 'object' &&
    typeof store.$state.constructor === 'function' &&
    !store.$state.constructor.toString().includes('[native code]')
  ) {
    console.warn(`[🍍]: The "state" must be a plain object. Found in store "${$id}".`)
  }

  isListening = true
  isSyncListening = true
  return store
}