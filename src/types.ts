/**
 * types —— 公开类型定义(简化版泛型)
 * 对应官方:packages/pinia/src/types.ts
 * 教学点:
 * 1. 官方在类型层面有大量体操(_ExtractStateFromSetupStore 全家、Store<Id,S,G,A>
 *    的 UnwrapRef 交叉类型),mini 只保留「骨架泛型」——保证 examples/tests 可编译、
 *    常见写法可推断,完整差异记入 docs/06 对照表;
 * 2. PiniaCustomProperties / PiniaCustomStateProperties 保留为空接口:这是官方留给
 *    插件的类型扩展入口,插件用 declare module 'pinia' 往全局 Store 类型上追加属性。
 */
import type {
  App,
  ComputedRef,
  EffectScope,
  Ref,
  UnwrapRef,
} from 'vue'

/** 状态树:任意嵌套的普通对象 */
export type StateTree = Record<string | number | symbol, any>

/** options 语法里的 getters 树:每个 getter 是 (state) => value 的函数 */
export type _GettersTree<S extends StateTree> = Record<
  string,
  (this: any, state: S) => any
>

/** actions 树:任意函数集合 */
export type _ActionsTree = Record<string, (...args: any[]) => any>

/** 插件扩展口:返回的类型会与 Store 交叉(见文件头教学点 2) —— 空接口用于 declare module 扩展 */
export interface PiniaCustomProperties {}
export interface PiniaCustomStateProperties {}

/** 订阅变更类型(常量:与官方 4.1 值逐一相同) */
export const MutationType = {
  direct: 'direct',
  patchObject: 'patch object',
  patchFunction: 'patch function',
} as const
export type MutationType = (typeof MutationType)[keyof typeof MutationType]

/** 调试事件:官方透传 Vue 的 DebuggerEvent,mini 简化为 any */
export type DebuggerEventsRaw = any

/** 订阅回调收到的三种变更载荷(官方用可辨识联合,mini 保留同样形状)
 * 注意:type 字段用 typeof MutationType.x 引用常量字面量类型
 * (直接写 MutationType['direct'] 会被同名 type 别名遮蔽而报错) */
export interface SubscriptionCallbackMutationDirect {
  storeId: string
  type: typeof MutationType.direct
  events: DebuggerEventsRaw[] | DebuggerEventsRaw
}
export interface SubscriptionCallbackMutationPatchObject {
  storeId: string
  type: typeof MutationType.patchObject
  payload: Partial<StateTree> & { [k: string]: any }
  events: DebuggerEventsRaw[] | DebuggerEventsRaw
}
export interface SubscriptionCallbackMutationPatchFunction {
  storeId: string
  type: typeof MutationType.patchFunction
  events: DebuggerEventsRaw[] | DebuggerEventsRaw
}
export type SubscriptionCallbackMutation =
  | SubscriptionCallbackMutationDirect
  | SubscriptionCallbackMutationPatchObject
  | SubscriptionCallbackMutationPatchFunction

/** 订阅回调:mutation 描述 + 变更后的 state */
export type SubscriptionCallback<S = StateTree> = (
  mutation: SubscriptionCallbackMutation,
  state: S,
) => void

/** $subscribe 的选项(简化:不透传完整 watch 选项) */
export interface SubscribeOptions {
  deep?: boolean
  flush?: 'pre' | 'post' | 'sync'
  /** true 时订阅不随所在 effectScope(组件)卸载而自动移除 */
  detached?: boolean
  /** 直接变更时捕获 Vue 调试事件(官方用于 devtools) */
  onTrigger?: (event: any) => void
}

/** Pinia 实例的公开形状(下划线前缀为官方内部字段,mini 跟随) */
export interface Pinia {
  install(app: App): void
  use(plugin: PiniaPlugin): Pinia
  /** 已安装插件(回调)数组 */
  _p: PiniaPlugin[]
  /** 挂载的 app(install 之前为 null) */
  _a: App | null
  /** 根级 effectScope(detached:不随任何组件卸载而停) */
  _e: EffectScope
  /** store 注册表:id → store 实例 */
  _s: Map<string, StoreGeneric>
  /** 数据仓库:id → 响应式 state(store.$state 读的就是它) */
  state: Ref<Record<string, StateTree>>
}

/** 插件上下文四件套 */
export interface PiniaPluginContext<
  Id extends string = string,
  S extends StateTree = StateTree,
  G extends _GettersTree<S> = _GettersTree<S>,
  A = _ActionsTree,
> {
  pinia: Pinia
  app: App
  store: Store<Id, S, G, A>
  options: DefineStoreOptions<Id, S, G, A> | DefineSetupStoreOptions<Id>
}

/** 插件:在 store 创建后执行,可返回扩展对象铺到 store 上 */
export type PiniaPlugin = (
  context: PiniaPluginContext,
) => (Partial<PiniaCustomProperties> & PiniaCustomStateProperties) | void

/** store 上 $ 前缀的操作 API(用户声明的键不会用到 $ 前缀) */
export interface _StoreWithState<Id extends string, S extends StateTree, G, A> {
  $id: Id
  /** 读穿 pinia.state.value[id] 的响应式数据接口 */
  $state: S
  $patch: (
    partialStateOrMutator: ((state: S) => void) | Partial<S> & { [k: string]: any },
  ) => void
  $reset: () => void
  $subscribe: (
    callback: SubscriptionCallback<S>,
    options?: SubscribeOptions,
  ) => () => void
  $onAction: (
    callback: StoreOnActionListener<Store<Id, S, G, A>, string>,
    detached?: boolean,
  ) => () => void
  $dispose: () => void
}

/** getters 展开后:函数值变为已求值的结果值(computed 自动解包) */
export type _StoreWithGetters<G> = {
  readonly [K in keyof G]: G[K] extends (...args: any[]) => any
    ? ReturnType<G[K]>
    : UnwrapRef<G[K]>
}

/**
 * store 的公开形状:
 * _StoreWithState($ 方法)+ UnwrapRef<S>(state)+ getters 求值结果 + actions + 插件扩展。
 */
export type Store<
  Id extends string = string,
  S extends StateTree = {},
  G = {},
  A = _ActionsTree,
> = _StoreWithState<Id, S, G, A> &
  UnwrapRef<S> &
  _StoreWithGetters<G> &
  A &
  PiniaCustomProperties &
  PiniaCustomStateProperties

/** 无具体类型的 store(内部 Map 与部分 API 用) */
export type StoreGeneric = Store<
  string,
  StateTree,
  _GettersTree<StateTree>,
  _ActionsTree
>

/** $onAction 的订阅上下文 */
export interface _StoreOnActionListenerContext<
  Store,
  ActionName extends string,
> {
  name: ActionName
  store: Store
  /** action 调用时的实参快照(与 action 内部共享同一数组,见 docs/03) */
  args: any[]
  after: (callback: (resolvedReturn: any) => void) => void
  onError: (callback: (error: any) => void) => void
}

export type StoreOnActionListener<
  Store,
  ActionName extends string,
> = (context: _StoreOnActionListenerContext<Store, ActionName>) => void

/** defineStore 的 options 参数(泛型 S/G/A 让 state/getters/actions 互相推导) */
export interface DefineStoreOptions<
  Id extends string,
  S extends StateTree = {},
  G extends _GettersTree<S> = {},
  A = _ActionsTree,
> {
  id?: Id
  state?: () => S
  getters?: G & ThisType<Store<Id, S, G, A>>
  actions?: A & ThisType<Store<Id, S, G, A>>
}

/** defineStore 的 setup 形式第三参(官方还带 HMR 相关选项,mini 省略) */
export interface DefineSetupStoreOptions<Id extends string> {
  id?: Id
}

/** 从 setup store 返回值里提取 state 类型:ref 解包,其余原样 */
export type _ExtractStateFromSetupStore<SS> = {
  [K in keyof SS]: SS[K] extends Ref<infer T> ? T : SS[K]
}

/** 提取 getter:computed 解包(骨架版,不追踪 nested/readonly 细节) */
export type _ExtractGettersFromSetupStore<SS> = {
  [K in keyof SS as SS[K] extends ComputedRef<any> ? K : never]: SS[K] extends ComputedRef<infer R> ? R : never
}

/** 提取 action:纯函数 */
export type _ExtractActionsFromSetupStore<SS> = {
  [K in keyof SS as SS[K] extends (...args: any[]) => any ? K : never]: SS[K]
}

/** defineStore 的返回值:可调用函数(useStore)+ store 形状 + $id */
export type StoreDefinition<
  Id extends string = string,
  S extends StateTree = {},
  G = {},
  A = _ActionsTree,
> = Store<Id, S, G, A> & {
  (pinia?: Pinia | null): Store<Id, S, G, A>
  $id: Id
}

/** setup 语法 defineStore 的返回值(& StateTree 使默认 S 满足 Store 的类型约束) */
export type SetupStoreDefinition<
  Id extends string = string,
  SS = any,
  S extends StateTree = _ExtractStateFromSetupStore<SS> & StateTree,
> = StoreDefinition<
  Id,
  S,
  _ExtractGettersFromSetupStore<SS>,
  _ExtractActionsFromSetupStore<SS>
>