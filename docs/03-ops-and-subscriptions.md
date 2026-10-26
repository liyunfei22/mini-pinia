# 03 操作与订阅 API:$patch / $subscribe / $reset / $onAction / $dispose 内部

> 对应源码:`src/store.ts` 的 createSetupStore($ 方法族)、`src/subscriptions.ts`(订阅容器)
> 行为基准:scripts/probes.mjs 对官方 4.1.0 的 31 条探测(每条探测标了编号)+ tests/operations.spec.ts、tests/parity.spec.ts

**一句话原理:$patch 是「先暂停 watcher、手动广播一次、nextTick 再恢复」的单次事件;**
**一切订阅都挂在 Set 上、触发器只有 triggerSubscriptions 一个。**

## 0. 基础设施:两个 Set + 唯一触发器

store 内部有两个订阅集合,`$` 方法与 action 包装共用同一套装载/广播函数:

| 集合 | 订阅者 | 装载者 | 广播点 |
| --- | --- | --- | --- |
| `subscriptions` | $subscribe 的回调 | `addSubscription(subscriptions, cb, detached, onCleanup)` | $patch / watcher 回调 |
| `actionSubscriptions` | $onAction 的回调 | `$onAction = addSubscription.bind(null, actionSubscriptions)` | wrapAction 内 |

`subscriptions.ts` 只有两个函数,订阅语义的根都在这里:

```ts
addSubscription(set, callback, detached, onCleanup = noop) {
  set.add(callback)                          // Set 天然去重
  const removeSubscription = () => {
    set.delete(callback) && onCleanup()      // delete 返回 true(真删掉了)才执行清理 —— 短路写法
  }
  if (!detached && getCurrentScope()) onScopeDispose(removeSubscription)  // 卸载自动解绑
  return removeSubscription
}
triggerSubscriptions(set, ...args) { set.forEach(cb => cb(...args)) }     // Set 保证插入顺序
```

三个要点:

1. **顺序**:Set 遍历即按注册顺序广播(probe 27:`a,b`);forEach 中删除也是安全的;
2. **去重**:同一回调二次 `$subscribe` 在顶层被拦截 —— 告警并返回 noop(官方 R1007,probe 22/ops10);`$onAction` 无此告警,重复注册被 Set 静默去重(只触发一次);
3. **退订幂等**:第二次 delete 返回 false,`&&` 短路 → onCleanup(停 watcher)不会重复执行(ops9)。

## 1. $patch:两形态 + 三变量门控

### 1.1 两形态

```ts
function $patch(partialStateOrMutator: any) {
  let subscriptionMutation                      // 手动构造的「单次事件」载荷
  isListening = isSyncListening = false         // ① 关闸:暂停 watcher(直接变更的门)
  debuggerEvents = []                           // ② onTrigger 捕获口,聚合为数组
  if (typeof partialStateOrMutator === 'function') {
    partialStateOrMutator(pinia.state.value[$id])            // 函数形态:mutator 直接改 state,事件无 payload
    subscriptionMutation = { type: 'patch function', storeId: $id, events: debuggerEvents }
  } else {
    mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator)  // 对象形态:深合并引擎(utils.ts),事件带 payload
    subscriptionMutation = { type: 'patch object', payload: partialStateOrMutator, storeId: $id, events: debuggerEvents }
  }
  const myListenerId = (activeListener = Symbol())            // ③ 记下自己的开关标记
  void nextTick().then(() => {                                // ④ 下一轮微任务才开闸
    if (activeListener === myListenerId) isListening = true   //    只有「最后发起」的 patch 能恢复
  })
  isSyncListening = true                                      // ⑤ sync 门立即放行(已无变更可触发)
  triggerSubscriptions(subscriptions, subscriptionMutation, pinia.state.value[$id])  // ⑥ 手动广播一次
}
```

- **对象形态** = `mergeReactiveObjects` 深合并:纯对象递归合并、Map/Set 增量更新、新键直接赋值;事件带 `payload`(传入的 partialState);
- **函数形态** = mutator 直接改 `pinia.state.value[$id]` 本体;事件**不带** payload;
- 新增键进 `$state` 但 store 上不可见(按需展开不回溯,probe 11)。

### 1.2 三变量门控与事件时序

| 变量 | 直接变更时 | $patch 期间 | 作用 |
| --- | --- | --- | --- |
| `isListening` | true | false → nextTick 后恢复 true | 默认 flush(pre)watcher 的门 |
| `isSyncListening` | true | false → $patch 末尾立即恢复 true | flush:'sync' watcher 的门 |
| `activeListener` | — | 每次 = 新 Symbol | 只有最后一个 patch 能恢复 isListening |

watcher 回调里的判定(`$subscribe` 内部):`options.flush === 'sync' ? isSyncListening : isListening`。
两扇门把「直接变更的 watcher 事件」与「$patch 的手动广播」严格分开:

```text
直接变更:count++ → sync watcher 变更瞬间 1 次 direct(probe 08)/ 默认 pre 同步段 0 次、
  nextTick 后 1 次(probe 07)/ post 渲染完成后 1 次(ops13)

$patch:关闸(isListening=isSyncListening=false)→ 合并/执行 mutator(期间 watcher 触发全被拦)
  → 手动 triggerSubscriptions 广播一次 → nextTick 后开闸 → watcher 不补发:
  等一轮微任务事件数不变(probe 04/08)
```

### 1.3 activeListener:嵌套 patch 为什么不会「提前恢复」

同一调用栈里连续/嵌套出现多个 $patch 时,每个都把**自己的** Symbol 写进 `activeListener` 并注册 nextTick 恢复。若不加门控,**外层** patch 的恢复回调先执行,会在嵌套 patch 完成前把 isListening 打开 —— watcher 就有机会在补发窗口多报一次 direct。activeListener 把「恢复权利」只留给最后发起的 patch:每次新 patch 覆盖 activeListener,旧 `myListenerId` 对照失败、恢复回调被放弃;只有最内层 patch 的恢复生效,watcher 始终保持静默。

### 1.4 事件载荷形状(probe 25 / ops3,键齐全性实测)

| type | 载荷键(Object.keys 排序) | payload | 广播者 |
| --- | --- | --- | --- |
| `direct` | `events, storeId, type` | 无 | 直接变更 → watcher 回调 |
| `patch object` | `events, payload, storeId, type` | 有(partialState) | $patch 手动广播 |
| `patch function` | `events, storeId, type` | 无 | $patch 手动广播 |

这三种 type 就是官方 `MutationType` 的三个常量(`direct` / `patchObject` / `patchFunction`,probe 31)。
`events` 字段来自 dev 下 `$subscribeOptions.onTrigger` 的捕获:正常态(isListening=true)存单条调试事件,patch 中(isListening=false)聚合为数组 —— **教学点**:订阅回调其实拿不到「改了哪些键」的精确信息,官方同样拿不到,精确变更集只有 devtools 能还原。

## 2. $subscribe:一个被「三开」的 watcher

$subscribe 既不是纯订阅也不是纯 watcher,而是把两者焊接起来:

```ts
$subscribe(callback, options = {}) {
  if (subscriptions.has(callback)) { console.warn(/* R1007 */); return noop }  // ① 去重拦截
  const removeSubscription = addSubscription(subscriptions, callback, !!options.detached, () => stopWatcher())
  const stopWatcher = scope!.run(() => watch(                    // ② getter:监视自己的 state 槽位
    () => pinia.state.value[$id],
    (state) => {                                                 // ④ 两扇门(1.2)通过才放行
      if (options.flush === 'sync' ? isSyncListening : isListening)
        callback({ storeId: $id, type: 'direct', events: debuggerEvents }, state)
    },
    assign({}, $subscribeOptions, options),                      // ③ 选项合并
  ))!                                                            // ⑤ watcher 建在 store 的 scope 里
  return removeSubscription                                      // ⑥ 返回的 unsub
}
```

五参数逐项:

| 参数 | 取值 | 含义 |
| --- | --- | --- |
| getter | `() => pinia.state.value[$id]` | 只监视自己的 state 槽位,不碰别人 |
| deep | 默认 `true`($subscribeOptions) | 嵌套对象变更也触发(probe 09/ops8) |
| flush | 默认 `pre`(异步);可传 `sync`/`post` | 决定 direct 事件的时机(见 1.2) |
| onTrigger | dev 调试点捕获 | 把调试事件填进事件载荷的 `events` 字段(见 1.4) |
| detached | 默认 false | true 时跳过 onScopeDispose,不随组件卸载解绑 |

装载/退订链路:

- **装载**:callback 先进 `subscriptions` Set;watcher 建在 **store 的** effectScope 里(不是组件的),$dispose 停 scope 即停 watcher;
- **组件卸载自动解绑**:addSubscription 里 `!detached && getCurrentScope()`(见第 0 节)→ 卸载时执行 removeSubscription → 从 Set 删除 **并** 经 onCleanup 停 watcher(ops12 组件版实测);
- **手动退订**:返回的 unsub 走同一路径,幂等、不影响其他订阅者(probe 21/ops9);**detached:true** 则注册与 watcher 都脱离组件生命周期,卸载后仍触发(probe 28/ops11/ops12)。

## 3. $reset:函数形态 $patch 的特例

```ts
const $reset = isOptionsStore
  ? function $reset() {
      const newState = options.state ? options.state() : {}  // 调用时现取初始 state
      this.$patch(($state) => { assign($state, newState) }) // 借道 $patch 函数形态
    }
  : () => { throw new Error(`Store "${$id}" is built using the setup syntax and does not implement $reset().`) }
```

- 整段恢复 = 恰 1 次原子 `patch function` 事件、无 payload(probe 10/ops5:含嵌套与数组全部复原);
- 不产生 direct 事件:$patch 的关闸拦住了 watcher(parity par4 对拍:sync 订阅下序列为 `direct, direct, patch function`,两个 direct 来自恢复前的赋值);
- **setup 语法没有 $reset**(官方行为,probe 10b):setup 的 state 是 setup 函数内部变量,Pinia 守不住「初始值」,dev 直接抛错。

## 4. $onAction:挂在 wrapAction 上的钩子

action 创建时被 `wrapAction` 包一层,$onAction 的钩子就埋在这层里:

```ts
function wrappedAction(this: any, ...args) {
  setActivePinia(pinia)
  const afterCallbackSet = new Set(), onErrorCallbackSet = new Set()
  const after = cb => afterCallbackSet.add(cb)      // 注册钩子的钩子,挂在 ctx 上
  const onError = cb => onErrorCallbackSet.add(cb)
  triggerSubscriptions(actionSubscriptions, { args, name, store, after, onError })  // ① 先广播
  try { ret = fn.apply(this && this.$id === $id ? this : store, args) }  // ② 执行,this 落回
  catch (error) { triggerSubscriptions(onErrorCallbackSet, error); throw error }     // ③ 同步抛错
  if (ret instanceof Promise)
    return ret.then(v => { triggerSubscriptions(afterCallbackSet, v); return v })
             .catch(e => { triggerSubscriptions(onErrorCallbackSet, e); return Promise.reject(e) })
  triggerSubscriptions(afterCallbackSet, ret)       // ④ 同步成功:after 拿到返回值
  return ret
}
```

时序表(probe 13/14a/14b、ops14-16):

| action 行为 | 钩子 | 时机 | 调用方看到 |
| --- | --- | --- | --- |
| 同步返回 r | after(r) | fn 返回后、返回调用方前(同步) | r |
| 同步抛错 e | onError(e) | catch 内 | **原样 rethrow**(异常不吞) |
| 异步 resolve v | after(v) | promise resolve 后 | v |
| 异步 reject e | onError(e) | thenable 的 catch 内 | `Promise.reject(e)` 原样 re-reject(错误对象不被替换) |

载荷 `{ name, args, store, after, onError }`(probe 13):

- `name`:action 定义时的键名(写入 Symbol 字段 `ACTION_NAME`);
- `args`:**与 action 共享同一数组**(官方实测反直觉点,probe 15/ops17):`triggerSubscriptions` 在 fn 执行**之前**,钩子里 `ctx.args[0] = 999` 会改变 action 拿到的实参;
- `after`/`onError`:**每个 ctx 独立**的两个 Set,多钩子按注册顺序触发(ops18:h1 → h2),无上限;
- **detached 第二参**:`$onAction(cb, true)` —— 第二参直接是布尔(区别于 $subscribe 的对象 options),效果相同:不随 effectScope 停止移除(ops19);
- **this 落回**:`this.$id === $id` 才接受外来 this;解构调用、跨 store、`.call({ $id: 'hacked' })` 一律落回自己的 store(probe 16)。

## 5. $dispose:实例生命周期

```text
调用 store.$dispose()
 ├─ scope?.stop()                 停 store 的 effectScope:订阅 watcher、computed 一并停止
 ├─ subscriptions.clear()         清订阅 Set
 ├─ actionSubscriptions.clear()   清 action 钩子 Set
 ├─ [R1008] _s 里已有同 id 且不是自己 → console.warn(旧实例 dispose 会把新 store 一起摘掉)
 └─ pinia._s.delete($id)          从注册表摘除
留下:pinia.state.value[$id] 原样保留 —— $dispose 销毁的是「实例」,不是「数据」
```

**state 保留**是整个重建语义的关键(probe 18/19、ops20/21):

```text
useStore() 第一次 → 无 initialState → 执行 state() 填仓库            stateRuns=1,count=1
s1.count=5; s1.$dispose() → _s 摘除,仓库里 count=5 不动
useStore() 第二次 → 重建 → createOptionsStore 的 setup 见 initialState 已存在
                        → 跳过 state()(不重跑)→ toRefs 直接引用旧状态
结论:stateRuns=1、s2.count=5 —— 旧状态留给新实例;订阅/钩子是新实例新的一批
```

- 二次调用无害:scope 停了再停、Set 清了再清(probe 18/ops20);
- **对旧实例 dispose 告警**(R1008,ops22):重建同 id 后,再对旧实例调用 `$dispose()` → 告警,且 `_s.delete($id)` 会把**新** store 一起摘掉(`registeredStore !== store` 才告警);
- dispose 本身不算变更:不产生任何订阅事件(ops20);
- 整个 pinia 的销毁是 `disposePinia`(停根 scope → state 一并清空),与单 store 的 $dispose 是两层,勿混。

## 附:本节行为依据

- probes:`04/05`($patch)、`07/08/09`(flush/deep)、`10/10b`($reset)、`11`(新键)、`13/14a/14b/15`($onAction)、`16`(this)、`18/19`($dispose)、`21/22`(退订/去重)、`25`(事件键)、`27`(顺序)、`28`(detached)、`31`(MutationType)
- 组件环境补测(probes 声明留给 vitest):ops12(卸载自动解绑)、ops13(flush:'post');parity par3-par7 与官方逐项对拍