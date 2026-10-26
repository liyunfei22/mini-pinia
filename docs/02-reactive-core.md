# 02 · 响应式内核:按需展开、ref 解包与 getter 缓存

> 一句话原理:store 是 reactive 对象、pinia.state 是数据仓库,
> ref 经 Vue 的 unwrap 链让 `store.count`、`$state.count`、`pinia.state.value[id].count`
> 三点互通;而 store 上只铺「声明过」的键——未声明的键,仓库里有也不上视图。

## 1. 全景:一个 store 的创建时间线

```
createSetupStore($id, setup, options, pinia)
 ├─ ① 骨架    partialStore:全部 $ 方法 + _p/$id + _customProperties
 ├─ ② 诞生    store = reactive(骨架),且 pinia._s.set($id, store)  ← 先于 setup!
 ├─ ③ 执行    runWithContext → pinia._e(根 scope) → 新建 store scope → setup({action})
 ├─ ④ 分发    ref/reactive → 状态仓库;function → wrapAction;computed → _getters
 ├─ ⑤ 双写    assign(store) + assign(toRaw(store))
 ├─ ⑥ 读穿    Object.defineProperty(store, '$state', get/set)
 ├─ ⑦ 插件    pinia._p.forEach → scope.run 注入扩展 → assign(store)
 └─ ⑧ 开门    isListening = isSyncListening = true
```

## 2. 六步细节

### ① partialStore 骨架

$ 方法全家($onAction / $patch / $reset / $subscribe / $dispose)+ 内部字段
(`_p` 指向 pinia、`$id`)+ `_customProperties: markRaw(new Set())`(插件扩展键名清单)。
$ 方法是「常驻」的:不来自用户声明,永远存在——用户声明的键不可能撞上 $ 前缀。

### ② reactive() 诞生,并**先**登记进 _s

```ts
const store: any = reactive(assign({ _customProperties }, partialStore))
pinia._s.set($id, store)          // 先登记,后填充
```

`pinia._s.set` 发生在 setup 执行**之前**——这是 getter 求值时能通过
`pinia._s.get($id)` 自引用 store(见 01 §4)、以及插件拿到 `context.store` 的前提。
「先登记后填充」是整条管线的顺序根基。

### ③ setup 在 scope 链里执行

```
pinia._a.runWithContext(...)     ← app 的 provide 上下文在 setup 期间可用
  └─ pinia._e.run(...)           ← 根 scope(effectScope(true),不随组件卸载而停)
       └─ (scope = effectScope()).run(() => setup({ action }))   ← 新建 store scope
```

store scope 是 $subscribe 创建 watcher 的宿主:`$dispose()` 停 scope 时,
该 store 的所有 watcher/effect 一并停止。

### ④ 三分发:setupStore 的键按类型分流

```ts
for (const key in setupStore) {
  const prop = setupStore[key]
  if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) → 状态分支
  else if (typeof prop === 'function')                        → action 分支
  else if (isComputed(prop))                                  → getter 分支
}
```

- **状态分支**(setup 语法):`pinia.state.value[$id][key] = prop`——仓库里存 **ref 本体**
  (store 上没有第二份拷贝);若存在 SSR 预置 state(initialState),先做 hydration:
  ref 直接灌值,reactive 对象先 clear 再用 mergeReactiveObjects 合并(见 §6);
- **action 分支**:`setupStore[key] = action(prop, key)` 套 wrapAction(打标记、
  this 落回自己的 store、after/onError 异步分流);
- **getter 分支**:记入 `setupStore._getters`(markRaw 数组,仅浏览器环境;调试用,
  官方在 dev 也这么做)。

### ⑤ 双写:assign(store) + assign(toRaw(store))

同一份 setupStore 分别铺到**响应式代理层**与 **toRaw 原始层**:store 上能读
(getter 已解包成值)、`toRaw(store)` 遍历到的也是完整键。**只铺声明过的键**——
这就是「按需展开」的名字由来:之后 `$patch` 新增的仓库键不会回流到 store 视图。

### ⑥ $state 读穿桥

```ts
Object.defineProperty(store, '$state', {
  get: () => pinia.state.value[$id],                    // 读 → 直通数据仓库
  set: (state) => $patch(($s) => assign($s, state)),    // 写 → 走 $patch(事件只广播一次)
})
```

$state 不是一份拷贝,是一个「读穿到仓库」的口子——probe 01 恒等断言成立的原因
(`store.$state === pinia.state.value.a`),也是 probe 02 toRaw 恒等的根源。

## 3. ref unwrap:三点互通

以 setup 语法为例——仓库里存的是 ref 本体,三点指向**同一个 ref**:

```
pinia.state.value[id] = { count: ref(0) }        ← 数据仓库:ref 本体
        │  (同一个 ref 对象,三处共享)
        ├──> store.count          store 是 reactive 代理 → 读取自动解包(.value)
        ├──> store.$state.count   $state get 直通仓库 → 同样解包
        └──> pinia.state.value[id].count          直读 ref 本体
修改其中任意一处,另外两处立刻看到(同源,无拷贝)。
```

- **store.count**:store 是 reactive 对象、count 属性是 ref → 属性访问自动 `.value`
  (Vue 的 unwrap 语义);
- **$state.count**:$state get 返回 `pinia.state.value[$id]`,它是响应式对象 →
  属性同样解包——三点读到的都是同一份数据;
- **options 语法差异**:仓库里放的是 `state()` 返回的普通对象,`toRefs()` 生成的
  ref 与它字段联动,「存 ref 本体」退化成「存对象 + ref 引用对象字段」——数据仍是
  同一份(tests/defineStore.spec.ts「$state 与 pinia.state.value[id] 恒等,读写互通」)。

## 4. 教学点:为什么组件里解构 store 会丢响应性

```ts
const { count } = store   // count 是「解包后的快照」:普通数字,与 store 再无关联
// 之后 store.count 变了,这个局部 count 不会变
```

原因正是 §3 的解包链:reactive 代理在读取属性时把 ref 解包成**值**,解构把
「值」拷进局部变量,引用链当场断掉。官方解法是 `storeToRefs`:把 store 的键变成
「ref 引用」——computed 包一层带 get/set 的 computed、ref/reactive 用
`toRef(store, key)` 保持双向同步,解构后仍是响应式引用(完整展开见 docs/04;
probe 17 已对拍分类行为)。这里先记住结论:**解构 store 拿数据,必须走 storeToRefs**。

## 5. getter 缓存:computed 的 dirty 位机制

options getter 与 setup 返回的 computed 落进同一个引擎(Vue 的 computed):

1. **首次读取**:求值一次,结果进缓存,dirty 位置 false;
2. **再次读取**:dirty 仍为 false → 直接返回缓存,不再求值——连续读三次
   只求值一次(probe 12:computedCount 恒为 1);
3. **依赖变更**:computed 依赖的 ref 变化只把 dirty 置回 true(**惰性标记**,
   不立即重算);
4. **再次读取**:dirty 为 true → 重新求值并再次缓存(probe 12:一次变更后
   恰好重算一次,计数 1 → 2)。

这就是「getter 带缓存、且永远与 state 同步」的全部秘密——0 行自写逻辑,全部继承 Vue。

另有一行值得单独讲:getter 求值里 `setActivePinia(pinia)` 的目的。computed 求值是
**惰性**的,可能发生在任意时刻——包括异步 action 的 then 回调里、组件外。
求值前显式把模块级 activePinia 钉成本 store 所属的 pinia,保证「那一刻的当前
pinia」正确:getter 里再调用其他 `useStore()` 时,取 pinia 的三级链路(01 §2)
不会落到错误的单例上(SSR 跨请求安全)。

## 6. mergeReactiveObjects:$patch 的深合并引擎

`$patch(对象形式)` 最终落到 utils.mergeReactiveObjects(target = 仓库 state, patch):

| patch 值 | 行为 |
| --- | --- |
| Map / Set | 增量:`set(key, value)` / `add(value)`(Set 显式绑 this) |
| 双方纯对象、target 已有该键、patch 值非响应式 | 递归合并(新键走覆盖) |
| 其余(新键、非纯对象、ref/reactive 值) | 整体赋值 |

- **isPlainObject 的 toJSON 检查**:带 `toJSON` 方法的对象(如 Day.js 日期)会被 Vue
  序列化成字符串,官方宁可判它「非纯对象」避免深度合并出错;
- **浅 ref 通知**:递归合并的键若是 shallowRef 目标,手动 `triggerRef` 通知依赖刷新
  (浅 ref 不自动深层追踪,合并改了内层就必须点一下);
- probe 04 实证:深合并后兄弟键保留(`nested.a === 1`)、新键出现(`nested.b === 2`)。

## 7. 官方行为证据

| 结论 | 证据 |
| --- | --- |
| $state 与仓库恒等(读穿) | probe 01、02;parity「$state 读穿」 |
| 只铺声明过的键 | probe 03(store 临时属性不进 $state)、probe 11($patch 新键只在仓库,store 上不可见) |
| getter 缓存与惰性重算 | probe 12;parity「getter 缓存:同一驱动脚本下,两边副作用计数一致」 |
| setup 仓库存 ref 本体 | tests/setupStore.spec.ts「仓库里存的是 ref 本体(token 化)」 |
| 深合并保兄弟键 | probe 04;parity「$patch 两形式:事件序列与最终 state 一致」 |

到这里,「store 为什么是响应式的」已经闭环:数据只有一份(仓库),视图按需展开、
$state 读穿、getter 惰性缓存、patch 深合并——下一站 docs/03,看操作 API 如何
围绕同一份数据广播事件。