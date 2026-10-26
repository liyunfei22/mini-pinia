# mini-pinia

> 为学习 **Pinia 4** 的原理和源码而写的最小实现。不生产可用,只做教学可用。

从零实现 [Pinia](https://github.com/vuejs/pinia)(Vue 3 + TypeScript),**行为以官方 pinia 4.1.0 为唯一基准**:

- 🔍 先读官方源码再写代码:`node_modules/pinia/dist/pinia.js` 即官方 `packages/pinia/src/*` 的平铺(`//#region` 标记),1535 行;
- 🧪 官方行为探测基线:`npm run probe` —— 31 条边界行为实测脚本,实现任何模块前先钉死官方行为;
- 🎯 行为对拍:`tests/parity.spec.ts` 让同一批 store 定义分别跑官方与 mini,状态、getter 值、$patch 结果、订阅事件序列、action 调用链**必须一致**;
- 📚 中文原理文档:`docs/` 七篇,读者读完可掌握 Pinia 原理与代码。

## 运行

```bash
npm install        # ⚠️ 本机代理失效:请用 env -u http_proxy -u https_proxy \
                   #   -u HTTP_PROXY -u HTTPS_PROXY npm install 直连
npm run probe      # 官方 pinia 行为探测基线(实现前先跑,只断言官方)
npm test           # vitest 单元测试 + 与官方对拍(68+ 例)
npm run dev        # Vite demo(http://localhost:5173)
npm run build      # 库产物 dist/(tsc)+ demo 产物 dist-demo/(vite)
```

## 功能对照(官方 4.1 vs mini)

| 功能 | mini | 说明 |
| --- | --- | --- |
| defineStore(options / setup 语法) | ✅ | 两种语法归一为同一条创建管线(docs/01) |
| state / getters / actions | ✅ | 按需展开、响应式 state、computed 缓存 getter、this 绑定 action(docs/02) |
| $patch / $reset / $subscribe / $onAction / $dispose | ✅ | 事件序列与 flush 时序与官方对拍一致(docs/03) |
| storeToRefs / mapState / mapGetters / mapActions / mapWritableState | ✅ | 选项式 API 辅助齐全(docs/04) |
| 插件系统 pinia.use | ✅ | 上下文四件套 + 扩展铺 store(docs/05) |
| devtools / HMR / SSR 深支持 / mapStores / skipHydrate | ⛔ 见 docs/06 | 简化点诚实清单 + mini↔官方源码对照表 |

## 项目结构

```
src/
├── index.ts          # 公共 API 出口(与官方 index.ts 对齐)
├── createPinia.ts    # pinia 实例:effectScope(true) 根作用域 + state 仓库 + install/use
├── store.ts          # 核心:defineStore / createOptionsStore / createSetupStore(全部 $ 方法)
├── rootStore.ts      # 模块级 activePinia / setActivePinia / getActivePinia / piniaSymbol
├── subscriptions.ts  # 订阅容器(Set)addSubscription / triggerSubscriptions
├── storeToRefs.ts    # 按 computed/ref/reactive/其他 四分类提取可解构引用
├── mapHelpers.ts     # mapState / mapGetters / mapActions / mapWritableState
├── types.ts          # 简化公开类型(骨架泛型,差异记 docs/06)
└── utils.ts          # isPlainObject / isComputed / mergeReactiveObjects
tests/                # 每模块一个 spec + parity.spec.ts(与官方对拍)
scripts/probes.mjs    # 官方行为探测基线
examples/             # Vite demo(全部核心特性可视化)
docs/                 # 中文原理文档,建议按 README → 01 → … → 06 顺序阅读
```

## 里程碑

- [x] M1 脚手架(配置 + 官方行为探测基线)
- [x] M2 createPinia + defineStore 核心(两种语法归一 + 按需展开 + 插件执行)
- [x] M3 操作 API($patch/$reset/$subscribe/$onAction/$dispose)
- [x] M4 storeToRefs + mapXxx + 插件系统
- [x] M5 examples + docs + 发布

## 致谢

向 [Pinia](https://github.com/vuejs/pinia) 与作者 Eduardo San Martin Morote 致敬——本项目的架构、注释与行为逐一对照官方源码,只有教学意义,无任何商业用途。