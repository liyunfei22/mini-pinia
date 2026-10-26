# 06 mini ↔ 官方对照表、简化点诚实清单与继续啃官方的路线图

> 本文是 docs 系列的「地图」:每个 mini 文件在官方源码与 `dist/pinia.js` 里的精确位置、mini 砍了什么、哪些「想当然」被实测证伪,以及下一步阅读顺序。所有行号均为本次写作时对官方 dist 的实测(用 `grep -n "#region"` 定位文件边界、用 `grep -n` 定位函数入口),可在本地 `node_modules/pinia/dist/pinia.js` 逐条复核。

## 6.1 mini ↔ 官方文件映射表

`node_modules/pinia/dist/pinia.js` 是官方 `packages/pinia/src/*` 的平铺产物(1535 行),`//#region src/xxx.ts` 注释即文件边界——不需要源码也能导航官方实现,本表行号即由它验证(区间含 endregion 行)。

| mini src | 官方 packages/pinia/src | dist/pinia.js 行号 | 备注 |
| --- | --- | --- | --- |
| src/index.ts | index.ts | 仅第 1535 行导出清单 | 与官方 index.ts 对齐的公共出口,无运行期逻辑 |
| src/createPinia.ts | createPinia.ts | 833-881 | install/use/队列/disposePinia;官方另在 install 时自动注册 devtools(849 register、864 use(devtoolsPlugin))——mini 无 |
| src/store.ts | store.ts | 969-1382 | 全项目最核心:defineStore(1345)/createOptionsStore(1020)/createSetupStore(1045)/$ 方法/插件执行(1320-1337) |
| src/rootStore.ts | rootStore.ts | 63-106 | activePinia(68)/setActivePinia(75)/getActivePinia(79-93)/getStores(91)/piniaSymbol(105) |
| src/types.ts | types.ts | 107-137 | 运行期仅 isPlainObject(108);类型体操在 dist/pinia.d.ts(Store 318、PiniaCustom* 350-354) |
| src/subscriptions.ts | subscriptions.ts | 953-968 | Set 容器 + onScopeDispose,官方 4.1 与 mini 逐行同构 |
| src/storeToRefs.ts | storeToRefs.ts | 1510-1534 | 分类提取;官方 1519 入口 |
| src/mapHelpers.ts | mapHelpers.ts | 1383-1509 | setMapStoreSuffix 1392 / mapStores 1417 / mapState 1437 / mapActions 1465 / mapWritableState 1486 |
| src/utils.ts | utils.ts(无专段) | 分散 | isPlainObject 108(types 区)、mergeReactiveObjects 981、isComputed 1017(store 区) |

官方独有、mini 未实现(行号即「继续啃」的起点):

| 官方文件 | dist 行号 | 内容 |
| --- | --- | --- |
| env.ts | 9-11 | IS_CLIENT(mini 搬进 store.ts:53 / rootStore 内联 `typeof window`) |
| diagnostics.ts | 12-62 | nostics 告警目录(why/fix/docs,8 个诊断码 R1001-R1008) |
| devtools/ 五文件 | 138-832 | file-saver 138-257 / utils 258-282 / actions 283-375 / formatting 376-460 / plugin 461-832 |
| hmr.ts | 882-952 | acceptHMRUpdate 925-951、patchObject 901 |

## 6.2 简化点诚实清单(每条:官方位置 + mini 取舍)

1. **devtools 全套**:官方 138-832 + install 自动注册(849/864)。mini 一行 devtools 代码都没有——它「零运行时正确性影响」(行为对拍不覆盖),且本身只是插件 API 的用户(见 docs/05 5.4),砍掉最能说明「devtools 不是 Pinia 本体」。
2. **HMR**:官方分布四处:hmr.ts 882-952(`acceptHMRUpdate` 925-951)、store.ts 内 `_hmrPayload`(1168)/`_hotUpdate`(1250-1303)/`_hotUpdating`(1055)、useStore 的 hot 分支(1368-1373,热更新时重建 store 再 `hot._hotUpdate(newStore)`,配合 `useStore._pinia` 1359)、createOptionsStore 的 hot 分支(hot=true 时跳过初始 state() 执行,1024-1044)。mini 无任何 hot 参数——纯开发期便利,与运行时行为正交,实现成本却接近整个 store.ts 的 1/5。
3. **SSR 深支持**:官方 `skipHydrateSymbol`(996)/`skipHydrate`(1004)/`shouldHydrate`(1013),setup 语法 state 入仓前的 shouldHydrate 守卫在 1209;`options.hydrate` 插桩在 1339(SSR 序列化不够用的逃生舱,如服务端/客户端值不同的 customRef);getActivePinia 的 `!IS_CLIENT` 诊断(80-82,R1004)。mini 只做到「初始化不重复执行 state() + 注入链优先」两层,skipHydrate 整条设施未实现(R1004 用同文案 console.error 仿真,rootStore.ts:33-39)。
4. **nostics/diagnostics 告警设施**:官方 12-62 用 nostics 的 `defineDiagnostics` + `createConsoleReporter`,每条带 why/fix/docs URL(R1006 直接指向官方插件文档锚点)。mini 一律 `console.warn` 输出 why 句子(「[🍍]: …」前缀原样保留,R1002/R1003/R1006/R1007/R1008 与官方逐字一致);fix 提示与 docs 链接一律省略——告警文本 vs 告警基建的取舍。
5. **prod/dev 分支与 __VUE_PROD_DEVTOOLS__ tree-shaking**:官方几乎每处守卫都是双条件 `NODE_ENV !== 'production' || (typeof __VUE_PROD_DEVTOOLS__ !== 'undefined' && …)`(如 R1006 告警 1330-1336、_customProperties 记录 1327-1329),并在 dev 下把 _p/_hmrPayload/_getters/_customProperties defineProperty 成非枚举(1305-1326),避免污染遍历与 devtools。mini 一律 dev 行为(告警永远跑),`_customProperties` 直接留在骨架里(枚举键,store.ts:350)。取舍声明:可读性优先,tree-shaking 不是学习目标。
6. **TS 完整泛型体操**:`_ExtractStateFromSetupStore` 全家(Keys/Pick 版)mini 与官方实现一致(types.ts:227-247);但官方 Store 还有 `_StoreObject`、`_UnwrapAll`、`UnwrapRef` 深度交叉、`_StoreWithState` 的完整 $ 方法类型、`StoreDefinition` 双形态完整重载、`SetupStoreDefinition` 的 S/G/A 默认推演等(d.ts 318 是四段交叉),mini 只保留骨架(Store = _StoreWithState & UnwrapRef<S> & _StoreWithGetters<G> & actions交叉 & PiniaCustomProperties,types.ts:159-170)——够 `examples/` 与对拍测试编译,不够生产库。
7. **mapStores + setMapStoreSuffix**:官方 1392/1417,后缀(默认 `$store`)防 mapStores 展开的 id 与组件计算属性撞名。mini mapHelpers.ts 未实现这两枚,README 功能表第 6 行已标 ⛔。
8. **acceptHMRUpdate**:官方 925-951,唯一的用户侧 HMR API(配合 Vite `import.meta.hot`),与第 2 条联动砍掉。
9. **defineStore 单对象内联 id 形式**(`defineStore({ id, state, … })`)已在官方 3→4 移除:4.1 只接受 `(id, options)` 与 `(id, setup, options?)(dist 1345 实现即两种归一)。mini 跟随 4.1 形态,不背历史包袱。

## 6.3 被实测证伪的任务假设清单(scripts/probes.mjs)

| 假设 | 官方真相(一句话) | probe |
| --- | --- | --- |
| getter 可写(get/set 或直接赋值) | 赋值触发 Vue readonly 警告且不生效,仍返回缓存计算值 | 24 |
| 重复 $id 应有校验或报错 | 静默复用首个 store,第二次 defineStore 同 id 返回同一实例、不报错 | 20 |
| $onAction 的 args 是拷贝,改动不影响 action | 与 action 共享同一数组,hook 改 args 直达实参 | 15 |
| after/onError 有 10 个上限(类事件上限) | 容器是 Set,可挂任意数量,无上限 | 13 / 14a / 14b |
| 订阅 type 与 store 语法相关 | type 只由变更方式决定(direct / patch object / patch function),与 options/setup 语法无关;载荷键也按类型对齐(direct/patch function 无 payload) | 25 |
| 插件 use() 后对所有(含已存在)store 生效 | 插件只在「此后创建」的 store 上执行;install 前注册的先进队列,install 后转 _p,同样不回溯 | 23 / 23b |
| $patch 嵌套新键:类型层拒绝 → 运行期也拒绝 | 类型层 `_DeepPartial` 属性键必须已声明(未声明键编译期报错,官方与 mini 一致);运行期 probe 11 证明 `$patch({ brandNew: 1 })` 合法并写入 $state | 11 + types.ts:129-134 |

最后一条最反直觉、也最值得记住:**类型裁决与运行期裁决是两套系统**——「类型层拒绝、运行期合法」是官方 4.1 `_DeepPartial` 的固有设计(想要就得 as any 桥接),不是 mini 的简化缺陷。

## 6.4 已知差异速查 + 纪律声明 + 继续啃官方

**差异速查**(与官方不一致、但运行期等价的点):

| 点 | 官方 | mini |
| --- | --- | --- |
| 告警设施 | nostics 诊断对象(why/fix/docs + 修复建议) | console.warn 仅 why 句子(R1002/R1003/R1006/R1007/R1008 文案与官方逐字一致) |
| 环境分支 | dev/prod 双守卫 + tree-shaking | 一律 dev 行为 |
| piniaSymbol | dev 带描述 / prod 空 Symbol | 统一 `Symbol('pinia')` |
| $pinia 类型 | declare module '@vue/runtime-core' 增强 | 无声明;测试两套并存撞车 → as any(createPinia.ts:37-39 注释,运行期无差异) |
| MutationType / 订阅事件键 | — | 与官方逐一相同(probe 25/31 钉死);告警文案逐字一致见 6.2 第 4 条 |

**纪律声明**:行为以官方 pinia 4.1.0 为唯一基准——实现、测试、文档不一致处一律以官方为准修 mini;probe 断言失败 = 官方版本行为变化,以实际版本为准重新沉淀结论(scripts/probes.mjs 头注释);parity 对拍失败以官方为准(tests/parity.spec.ts 头注释)。本表若与新版本 dist 冲突,先跑 `npm run probe`。

**继续啃官方路线**(packages/pinia/src):阅读顺序建议 `store.ts` → `createPinia.ts` → `subscriptions.ts` → `mapHelpers.ts` → `devtools/plugin.ts`。理由:store.ts(414 行)是唯一核心,含创建管线与全部 $ 方法,读透它再看安装/订阅的收尾;mapHelpers 是「读 store 的另一种姿势」,适合当过渡;devtools/plugin.ts 放最后当「插件实战案例」读(它就是用公开插件 API 写出来的官方狗粮)。技巧:先 `grep -n "#region" dist/pinia.js` 定位区间,再回到 GitHub 官方仓库读 TS 原文件看完整注释与类型——dist 是地图,源码注释才是正文;本表行号本身就是一次完整的「dist 导航演示」。