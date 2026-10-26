# 01 · defineStore 语法归一:两种语法,一条管线

> 一句话原理:options store 在创建的一瞬间被「翻译」成 setup store
> (状态→toRefs、getters→computed、actions 原样),之后两条语法共用
> 同一条 `createSetupStore` 管线——所有 $ 方法、状态分发、getter 缓存、
> action 包装都只写一遍,只有一份内核。

## 1. 入口:defineStore 的 4.1 双重载

官方 pinia 4.1 的 defineStore 只有两种调用形态(d.ts 655 / 663;mini 同款,`src/store.ts`):

```ts
// 形态一:options 语法(对象参数)
defineStore(id, options)                          // { state?, getters?, actions? }
// 形态二:setup 语法(函数参数,第三参为可选的 setup options)
defineStore(id, storeSetup, options?)
```

实现里用一个三元判定分流:

```ts
const isSetupStore = typeof setup === 'function'
options = isSetupStore ? setupOptions : setup      // setup 是函数 → setup 语法
```

> 注意:官方早期还有「单对象内联 id」形态 `defineStore({ id, state, ... })`,
> 已在 4.x 移除——mini 与 4.1 一致,不提供;该历史形态的来龙去脉与类型差异
> 一并记入 docs/06 对照表。

## 2. useStore:取 pinia 的三级顺序

`defineStore` 返回的 `useStore` 是「取 pinia → 惰性建 store → 返回缓存」三步曲。
取 pinia 的顺序(`src/store.ts`):

```ts
pinia = pinia || (hasContext ? inject(piniaSymbol, null) : null)  // ① 显式参数 → ② 注入链
if (pinia) setActivePinia(pinia)                                  // 找到就先钉为「当前 pinia」
if (!activePinia) throw new Error('[🍍]: "getActivePinia()" was called ...')  // ③ 兜底失败
pinia = activePinia                                               // 模块级单例兜底
```

1. **显式参数**:`useStore(pinia)` —— 组件外(路由守卫、普通模块)直接传实例;
2. **组件注入链**:`hasInjectionContext()` 为真(组件 setup / computed / 生命周期内)
   时 `inject(piniaSymbol)`,取 install 时 `provide` 的 pinia;`inject` 的默认值
   `null` 避免「未提供」告警;
3. **模块级 activePinia**:前两者都空时回退 rootStore 里的模块单例——install、
   `setActivePinia()` 以及「上一步找到 pinia」都会写它,SSR 按请求切换就靠它
   这一行兜底。

**无 active pinia 抛错**:三步全落空时抛错——「'getActivePinia()' was called but
there was no active Pinia. Are you trying to use a store before calling
'app.use(pinia)'? ...」(官方 dev 守卫,测试见 tests/defineStore.spec.ts「没有
active pinia 时 useStore 抛错」)。

## 3. 惰性创建:第一次 useStore 才建 store

`defineStore` 调用本身**不创建任何东西**(state 不执行、store 不存在),只返回
带 `useStore.$id = id` 标记的闭包。真正的创建发生在首次 `useStore()`:

```ts
if (!pinia._s.has(id)) {                      // 缓存于 pinia._s(Map 注册表)
  if (isSetupStore) createSetupStore(id, setup, options, pinia)
  else               createOptionsStore(id, options, pinia)
}
return pinia._s.get(id)                       // 之后每次 useStore 返回同一个实例
```

- **缓存**:store 实例登记进 `pinia._s`,同一 pinia 下永远只有一份;
- **重复 $id**:同名 id 第二次 `defineStore` 时**静默复用首个 store**(不告警、
  不抛错)——官方实测行为(probe 20 与 parity「同 id 重复 defineStore」双重验证):

```ts
const a = useA()   // (第一次)创建 store:{ count: 1 } → _s.set('t', a)
const b = useB()   // _s.has('t') → 直接返回 a:第二个定义({count:99})被忽略
a === b            // true;且 a.count 仍是 1,第二个定义没有重置状态
```

## 4. options 语法:创建一瞬的翻译管线

`createOptionsStore` 的核心是一段「假 setup」:把 options 翻译成 setup 函数的
返回值,然后调用与 setup 语法**完全相同**的 `createSetupStore`(只是多传一个
`isOptionsStore = true` 标志):

```
defineStore('main', { state(), getters, actions })
  │ defineStore 只闭包 —— 此刻什么都没发生
  ▼
useStore() 首次调用
  ▼ createOptionsStore(id, options, pinia)
  setup():(闭包内,用 options 构造返回值)
  ├─ ① 状态:if (!initialState) pinia.state.value[id] = state()   ← 惰性初始化一次
  │         localState = toRefs(pinia.state.value[id])           ← 状态 → 响应式 refs
  ├─ ② actions:原样返回(分发阶段 function 分支统一套 wrapAction)
  └─ ③ getters:reduce 成 computed 字典
        computedGetters[name] = markRaw(computed(() => {
          setActivePinia(pinia)                    ← 求值环境钉死本 pinia(见 02 §5)
          const store = pinia._s.get(id)           ← 自引用:getter 里可读其他 getter/action
          return getters[name].call(store, store)  ← this 与第一个实参都是整个 store
        }))
  ▼
  createSetupStore(id, setup, options, pinia, isOptionsStore = true)
  ▲──────── 两条语法从这里开始完全共用一条管线 ────────
```

逐条注解:

- **状态惰性初始化一次**:`state()` 只在「仓库里还没有该 id 的 state」时执行;
  若此前 `$dispose()` 过(仓库保留旧状态),重建时不再执行 `state()`、旧状态直接
  继承(probe 19 + parity「$dispose 后重建同 id:两边都保留旧状态,state() 都不重跑」);
- **getters → computed**:`markRaw` 防止 computed 被 reactive 深转换;缓存、惰性重算、
  依赖跟踪三层语义全部继承 Vue,见 docs/02 第 5 节;
- **getter/state 重名告警**:`name in localState` 时 dev 告警(官方 R1002:
  「A getter cannot have the same name as another state property」)——重名时
  getter 键会覆盖状态键,官方宁可拦在源头(测试见 tests/defineStore.spec.ts);
- **`call(store, store)`**:getter 的 `this` 与第一个实参都是整个 store,于是既能
  用 `this.xxx` 互调 getter/action,也能用形参 `state` 读状态;
- **自引用成立的前提**:getter 求值是惰性的(读时才发生,必然在 store 创建之后),
  而 `pinia._s.get(id)` 之所以拿得到 store,是因为 createSetupStore 里 store **先
  登记后填充**(docs/02 §2 步骤②)——顺序不对,getter 就自引用不了。

## 5. setup 语法的 { action } helpers(官方 4.x 新增)

setup 语法的 setup 函数会收到第一个实参 `helpers`(SetupStoreHelpers,`src/types.ts`):

```ts
defineStore('x', ({ action }) => {
  const count = ref(0)
  const inc = action(function inc(step = 1) { this.count += step }, 'inc')
  return { count, inc }
})
```

- `action(fn, name?)`:在 setup **内部**提前手动包装 action,让 `$onAction` 也能
  感知「store 内部声明的函数」——官方 4.x 新增的能力;
- 与管线里的 wrapAction 同一套机制:带 `ACTION_MARKER` 的函数再次包装时只更新
  名字(`src/store.ts`),不会重复包裹;
- 不调 `action()` 也无妨——分发阶段没被包装的函数同样会被 wrapAction 收编,
  只是「包装发生在 store 诞生之后」,`$onAction` 的触发时机对使用者透明。

## 6. 小结:归一之后,两语法还剩哪些差异

| 行为 | options 语法 | setup 语法 |
| --- | --- | --- |
| 状态进仓库 | 翻译期用 toRefs 注册,分发阶段跳过 | 分发阶段 `pinia.state.value[id][key] = ref 本体` |
| $reset | 有(用初始 state 做一次函数形态 $patch) | 无,调用即抛错(「does not implement $reset()」,无诊断码) |
| hydration(SSR 预置 state) | initialState 存在 → 跳过 state() | initialState 存在 → 灌入 ref/reactive 初始值 |
| 其余($方法、getter、action、插件、订阅) | 完全相同 | 完全相同 |

两种语法、一套内核:options 只是「上面那层糖」,内核只有 `createSetupStore` 一份。
读 docs/02 时请记住:你看到的六步创建时间线,对两条语法同时成立。