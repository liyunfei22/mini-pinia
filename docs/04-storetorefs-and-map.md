# 04 storeToRefs 与 mapXxx:解构与 Options-API 的桥

> 对应源码:`src/storeToRefs.ts`、`src/mapHelpers.ts`
> 行为基准:probe 17(storeToRefs 分类)、parity「par8」(与官方对拍)、tests/mapHelpers.spec.ts(真实组件 mount)

**一句话原理:storeToRefs 按「computed/ref/reactive/其他」四分类挑选可解构的引用;**
**mapState/mapActions 则把 store 的键翻译成组件 computed/methods 里的函数,靠 `this.$pinia` 找到 pinia。**

## 1. 为什么不能直接解构 store

store 本身是响应式代理,但**解构把「引用」拆成了「快照」**。解包只发生在属性读取的那一瞬间:

```js
const store = useStore()      // store.count 读取时会解包成普通值
const { count } = store       // 值在解构瞬间被拷贝出来 → count 是普通数字
store.count = 5               // 变化发生在 store 上
count                         // 还是原来的 0 —— 快照不会跟随(响应性丢失)
// getter 同理:const { double } = store 拿到的是求值结果,不是会重算的引用
```

reactive 对象解构丢响应性,是 Vue 3 的固有语义;所以 Pinia 需要「取引用」的 API —— 就是 storeToRefs。注意:**actions 可以直接解构**(它们只是函数,this 会被 wrapAction 落回自己的 store,见 docs/03 第 4 节),storeToRefs 因此跳过函数。

## 2. storeToRefs:四分类挑选算法

伪代码与 src/storeToRefs.ts 逐行对应:

```text
storeToRefs(store):
  rawStore = toRaw(store)                  │ 1. 脱代理:在原始对象上遍历,不触发 getter/track
  refs = {}
  for key in rawStore:                     │ 2. 逐键四分类
    value = rawStore[key]
    ┌─ value?.effect → ① computed(getter) │ 3. 判定顺序:effect 先于 isRef(computed 也是 ref)
    │    refs[key] = computed({
    │      get: () => store[key]           │    读:永远走响应式代理 store,拿最新值
    │      set: v => (store[key] = v)      │    写:直接赋值写回 store(受 readonly 限制,probe 24)
    │    })
    ├─ isRef(value) || isReactive(value) → ② state
    │    refs[key] = toRef(store, key)     │    toRef 引用「store 上的键」:读写都穿到 store
    ├─ typeof value === 'function' → ③ action    │ 跳过(可直接解构)
    └─ 其他 → ④ 普通值(非响应式插件扩展)          │ 跳过(官方 R1006 在插件侧已提醒)
  return refs
```

四分类判定表:

| 判定 | 键的来源 | 处理 | 解构后行为 |
| --- | --- | --- | --- |
| `value?.effect` | getter(computed) | 新包一层带 get/set 的 computed | `.value` 可读可写;写 = 给 store 赋值 |
| `isRef(value)` 或 `isReactive(value)` | state | `toRef(store, key)` | 与 store **双向同步** |
| function | action | 跳过 | 直接解构即可 |
| 其余 | 插件加的非响应式值 | 跳过(R1006) | — |

双向同步示例(probe 17 / parity par8):

```js
const { count, double, self } = storeToRefs(store)
store.count = 5        → refs.count.value === 5   (store → ref)
refs.count.value = 9   → store.count === 9        (ref → store,toRef 写穿)
refs.double.value                              // 18:computed 每层都保持「活」的
refs.self.value.w                              // reactive → ref,内容同样双向
```

三个细节:

1. **判定顺序**:`value?.effect` 先于 `isRef` —— computed 也满足 isRef,必须先用 effect 特征区分(utils.ts 的 `isComputed` 就是 `isRef(o) && o.effect`);
2. **为什么不直接用 toRefs(store)**:toRefs 只接受 reactive 的已存在键,对 computed 键生成的是「读值 ref」且不可写;storeToRefs 对 computed 重包一层带 set 的 computed,解构后才是完整意义的 ref;
3. **插件 ref 也收编**:插件扩展经 `assign(store, extensions)` 写进代理(写穿到 toRaw 层),落入分类 ② —— 这是「storeToRefs 配合插件扩展」能用的基础。

## 3. mapXxx:把 store 键翻译成组件选项

`storeOf = (useStore, ctx) => useStore(ctx.$pinia)` —— 所有 map 函数的取值都从一句开始;`useStore` 显式拿到 pinia 参数后,「显式传入 → inject → activePinia」取档链第一格直接命中(见第 4 节)。

### mapState / mapGetters(mapState 别名)

| 形态 | 输入 | 组件里的键 | 生成的 computed |
| --- | --- | --- | --- |
| 数组 | `['count', 'double']` | 同名 `count` / `double` | `() => storeOf(useStore, this)['count']`(键名直映) |
| 对象·字符串 | `{ n: 'count', doubled: 'double' }` | `n` / `doubled` | 键重映射:`() => store[keysOrMapper[key]]` |
| 对象·函数 | `{ upperName: (store) => store.name.toUpperCase() }` | `upperName` | `fn.call(this, store)`:**以组件实例为 this、实参是 store** |

函数形态的存在意义:派生值需要组件数据时(computed 里可照读 `this.xxx`),函数以组件为 this;纯依赖 store 就只用第一个实参。mapHelpers.spec.ts 实测:store 变更 → 组件 computed 跟随(vm.count 5 → 10)。**mapGetters = mapState 别名**:官方标注 deprecated,行为完全一致(数组形态实测)。

### mapActions:参数透传、返回值原样返回

```js
computed: {}, methods: {
  ...mapActions(useStore, ['incBy']),          // this.incBy(...args) → store.incBy(...args)
  ...mapActions(useStore, { addTwo: 'incBy' }),// 对象形态 = 键重映射:组件方法名 → store 键
}
// this.addTwo(2) === 返回 store.incBy(2) 的返回值
```

- **this 无虞**:action 已被 wrapAction 包装,即使以组件方法形式被调用,this 也落回自己的 store(probe 16 的「外来 this 被拒绝」);
- 对象形态允许跨 store 键重命名(methods 名 ≠ store 键)。

### mapWritableState:可写映射(专供 v-model)

```js
const createDescriptor = (from) => ({
  get()  { return storeOf(useStore, this)[from] },
  set(v) { return (storeOf(useStore, this)[from] = v) },  // 直接赋值,不是 $patch
})
// 组件:computed: { ...mapWritableState(useStore, { writableCount: 'count' }) }
// 模板:<input v-model="writableCount" />
```

- 返回的是计算属性**描述符** `{ get, set }`,与 Options-API computed 直接对接;双向可用(mapHelpers.spec.ts:组件写 → store 变;store 变 → 组件读);
- **教学点**:set 是「直接赋值」而非 `$patch` —— 经 mapWritableState 写入触发 watcher 的 direct 事件(默认异步 flush),而 `$patch` 产生同步 patch 事件;两条写入路径的订阅体感不同(时序细节见 docs/03 第 1.2 节);
- 数组/对象形态与 mapState 相同(对象形态为键重映射)。

## 4. this.$pinia:注入链的 Options-API 那一端

map 函数为什么拿得到 pinia?因为 install 时做了两件配套的事(createPinia.ts):

```ts
install(app) {
  app.provide(piniaSymbol, pinia)               // ① 组合式 API 的入口:provide/inject 链
  app.config.globalProperties.$pinia = pinia    // ② Options-API 的入口:全局属性
}
```

两条取 pinia 的路径,在 useStore 的第一行汇合(store.ts):

```text
setup 组件 / 组合式:   inject(piniaSymbol)  ──┐
Options-API 组件:     this.$pinia           ──┤ useStore(pinia?) 首行:
非组件环境(脚本/SSR): 模块级 activePinia    ──┘   pinia = pinia || inject(...) || activePinia
```

要点:

1. **为什么 Options-API 必须走 globalProperties**:computed getter / methods 里的 `this` 是组件实例,拿不到 provide/inject 上下文;所以 map 生成的每个函数都**在调用时**动态执行 `useStore(ctx.$pinia)` —— store 引用每次现取,dispose 重建后也能拿到新实例;
2. **`provide` 与 `globalProperties` 是同一个 pinia 实例**:两种语法混用时(setup 里包 Options、父 setup 子 Options)两边拿到同一实例、同一份 state —— 同一条注入链的两端;
3. `useStore` 的显式参数路径第一优先:map 函数正是走这条路径,与组件内 `useStore()` 殊途同归。

## 5. 简化点提示

**mapStores / setMapStoreSuffix 未实现**(官方 4.1.0 mapHelpers.ts 1384-1428):mapStores 一次映射多个 store,并把 store $id 变成组件键名且自动加后缀(默认 `Store`,可用 setMapStoreSuffix 改)。mini 的 mapState/mapActions 已覆盖其核心场景(单 store 映射 + 键重映射 + 函数形态);mapStores 的完整对照与差异说明见 docs/06 简化点清单。

## 附:本节行为依据

- probes:`16`(action this 落回)、`17`(storeToRefs 分类/取值/跟随)、`24`(可写 getter 无效 + readonly 警告)
- parity `par8`:storeToRefs 的键集合、正向同步、反向写入与官方逐一相等;mapHelpers.spec.ts 在真实 Options-API 组件里验证 this.$pinia 注入链与两形态/函数形态、mapWritableState 双向、mapActions 透传