# 05 插件系统与上下文注入

> 一句话原理:插件 = 在 store 创建后、对外可见前,在 **store 自己的 effectScope** 里执行的「扩展示例」,返回的对象直接铺进 store;它需要的上下文由 install 阶段的 `provide` + `_a` + `_p` 提供。

## 5.1 安装:`app.use(pinia)` 做了什么

```ts
// src/createPinia.ts 的 install(官方 createPinia.ts 同款五步)
install(app) {
  setActivePinia(pinia)                 // ① 模块级单例指向本实例
  pinia._a = app                        // ② install 完成标记,插件 ctx.app 的来源
  app.provide(piniaSymbol, pinia)       // ③ 组件内 useStore 的注入链源头
  globalProperties.$pinia = pinia       // ④ Options-API:this.$pinia / mapXxx 的底座
  toBeInstalled.forEach(p => _p.push(p)) // ⑤ use() 排队插件统一入列
  toBeInstalled = []
}
```

- ①:组件外(模块顶层、路由守卫、SSR 请求级)调用 useStore() 时靠模块级 `activePinia` 兜底定位;
- ②③:组件内 useStore() 优先走 provide/inject 注入链,拿不到才回退 ①——`rootStore.ts` 的 `getActivePinia` 就这两行逻辑,SSR 安全全在此;
- ④:官方用 `declare module '@vue/runtime-core'` 把 `ComponentCustomProperties.$pinia` 增强成 Pinia 类型;测试程序里 mini 与官方两套声明并存会在此类型撞车 → 代码里 `as any`(运行期无差异,见 docs/06 差异速查);
- ⑤:install **之前** `use()` 注册的插件先进 `toBeInstalled` 队列,install 时才转入 `_p`。

### 为什么「先 use 后 install」的插件对当时已存在的 store 不生效

插件的唯一执行时机是 **store 创建时**(createSetupStore 尾部 `pinia._p.forEach`)。`use()` 只是登记:install 前排队、install 后直接进数组,除此之外不触发任何执行。因此时序上:store 必须在插件进入 `_p` **之后**创建,才看得到它。

- 官方实测(probe 23b 反例):先创建 store x、再 `pinia.use(...)` 注册新插件——已存在的 `store.$late` 恒为 `undefined`,插件只在新创建的 store x2 上执行(`late` 数组里只有 `'x2'`);
- 队列同理:install 前 use() 的插件,对 install 前已创建的 store 不回溯(probe 23/23b + tests/plugins.spec.ts「use() 在 app.use 前注册」用例钉死);
- 对学习者的意义:插件不是「订阅模式」,是同一条创建管线尾部的**扩展队列**——想影响哪个 store,就得赶在它创建之前 use()。

## 5.2 插件的上下文:ctx 四件套

`PiniaPluginContext`(src/types.ts:102-118)的四个字段及其来源:

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `store` | 正在创建的响应式 store | 已含骨架($id/$patch/$subscribe/…)+ 展开后的 state/getters/actions;插件读它,返回的扩展也铺它 |
| `app` | `pinia._a` | install 后是真实 App;**未 install**(如独立测试只 setActivePinia)时为 null |
| `pinia` | pinia 实例本身 | `_p` 数组正在被 forEach;插件里再 use() 只影响以后的 store |
| `options` | `optionsForPlugin` | 用户传给 defineStore 的选项;`actions` 是**原始**函数(包装前的) |

最后一行值得展开(store.ts:171,386):

```ts
const optionsForPlugin = assign({ actions: {} }, options)
// 按需展开的 action 分支里,顺序是:
setupStore[key] = action(prop, key)     // 先包装
optionsForPlugin.actions[key] = prop    // 再把原始函数登记给插件
```

教学点:插件想对 action 做手脚(埋点、加 after/onError),只能从 `ctx.options.actions.xxx` 拿用户写下的原函数——store 上拿到的永远是 wrapAction 包过一次的 wrapper。

## 5.3 执行时机与作用域

```ts
// createSetupStore 尾部(store.ts:407-430,官方 dist 1320-1337)
pinia._p.forEach((extender) => {
  const extensions = scope!.run(() =>
    extender({ store, app: pinia._a, pinia, options: optionsForPlugin }),
  )
  if (extensions) {
    Object.keys(extensions).forEach(k => store._customProperties.add(k)) // 扩展键名单
    // R1006:非响应式普通对象扩展 → dev 告警(storeToRefs 收不到)
    for (const key in extensions) { /* 非 ref / 非 reactive / 无 __v_skip → console.warn */ }
    assign(store, extensions)   // 返回值直接铺进 store,ref 由 reactive 代理自动解包
  }
})
```

- **时机**:在「执行 setup → 按需展开 → $state 桥」之后、store 对外返回之前——插件看到的 store 已完全成形,而它的增强在用户拿到 store 的那一刻已就位(官方文档原话精神:插件在 store 创建后、「对外可见」前执行,mini 与之同序);
- **作用域**:每个插件包在 `scope.run(...)` 里,scope 是本 store 自己的 effectScope。为什么必须是它:
  - 生命周期对齐:插件加的 `ref`/`computed`/`watch` 必须随 store 走——`$dispose` 停的就是这个 scope,`stop()` 一次全清;
  - 可被收编:storeToRefs 遍历时按 `isRef` 分类,插件 ref/computed 才能被解构带走;若建在组件 scope,组件先于 store 销毁则引用悬空;
  - 协作次序:先跑的插件铺下的属性,后跑的插件立即可读(官方文档 modifyState 类插件依赖这个次序)。
- **铺法**:`assign(store, extensions)`。store 是 reactive 代理,ref 属性读取自动解包(probe 23b:`store.count2 === 10`,不是 Ref 对象);`_customProperties`(markRaw 的 Set)逐个记录扩展键——这是官方留给 devtools 与调试的「插件来源清单」;
- **R1006**:扩展值是普通对象(非 ref、非 reactive、也没用 markRaw 打 `__v_skip` 标)时 dev 下告警,提示它不会被 storeToRefs 收集;想表达「我故意的」就 `markRaw()`。
- **边界与惯例**:插件是同步函数(`PiniaPlugin` 返回扩展对象或 void,官方 d.ts:590),没有「异步插件」形态;命名沿用官方「$ 前缀」惯例(`$state`/`$patch`/…一望即知是框架键),社区插件(pinia-plugin-persistedstate 的 `$persist` 等)同样遵循——新增键不碰旧键,这正是 `_customProperties` 审计「外来键」的存在理由。

### effectScope 嵌套关系

```
应用根 scope
├── 组件实例 scope(卸载自动 stop;useStore() 在此被调用)
│     └─ 非 detached 的 $subscribe 经调用点的 onScopeDispose 挂在此,随组件卸载解绑(虚线关联)
│
└── pinia._e —— createPinia 时 effectScope(true),detached:
      不挂任何组件之下,生命周期跟随 app,disposePinia 时 stop
      └── store scope(每个 store 一个,createSetupStore 内 `pinia._e.run(...)` 创建)
            ├── getter 的 computed、$subscribe 的 watcher
            └── 插件扩展的 ref/computed/watch —— 全部随 $dispose 一次 stop
```

要点:store scope 的父级是 `pinia._e` **而不是组件 scope**,所以 store 的生命周期独立于任何组件,组件里每次 useStore() 只是「取用」而非「收养」;probe 28(普通订阅随 effectScope 停止移除、detached 存活)正是这条链的可测形态。

## 5.4 官方 devtools:同一机制的重度用户

官方在 install 时(dev + 浏览器 + Proxy 可用)自动 `pinia.use(devtoolsPlugin)`(dist 864 行;另在 849 行 registerPiniaDevtools)。devtools 支持本身就是一个普通插件:

- 用 `ctx.store` 读当前 store,展示 state/getters/actions;
- 包装 action 以把调用分组上报(patchActionForGrouping,dist 793);
- 用 `_customProperties` 区分「声明键 vs 插件扩展键」。

因为 devtools 走的全是公开插件 API,mini 才能整体砍掉而不影响任何可观察行为——这正是 docs/06 简化清单第 1 条:devtools 不是「另一个系统」,恰是本文主角的用户(呼应 README 功能对照表第 5 行「插件 ✅」与第 6 行「devtools ⛔ 见 docs/06」)。

## 5.5 类型的扩展入口:空接口 + declare module

```ts
// src/types.ts:32-33 —— 官方与 mini 都保留这两张「空接口」
export interface PiniaCustomProperties {}
export interface PiniaCustomStateProperties {}
// Store = _StoreWithState & UnwrapRef<S> & _StoreWithGetters<G> & … &
//        PiniaCustomProperties & PiniaCustomStateProperties(types.ts:159-170)
```

插件库要让自己加的属性在所有 store 上都有类型,只需接口合并:

```ts
declare module 'pinia' {
  export interface PiniaCustomProperties<Id, S, G, A> {
    $axios: AxiosInstance   // 之后所有 store.$axios 有类型
  }
}
```

官方细节(d.ts 348-354):`PiniaCustomProperties` 交叉进 Store 本体;`PiniaCustomStateProperties` 交叉进 `$state`(`$state: UnwrapRef<S> & PiniaCustomStateProperties<S>`,并被 getter 的 state 参数引用);插件返回类型即 `Partial<PiniaCustomProperties & PiniaCustomStateProperties> | void`。

教学点:空接口 + `declare module` 模块增强是给「别人的类型」追加成员的标准姿势,与 Vue Router 增强 `ComponentCustomProperties` 同一套路——这也是上文 5.1 里 `$pinia` 类型撞车的根源(createPinia.ts:37-39 注释)。mini 的搁置面:官方这几处还各带 Id/S/G/A 泛型参数,mini 用无参空接口,类型差异记 docs/06 诚实清单第 6 条。