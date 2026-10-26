# mini-pinia

> 为学习 **Pinia 4** 的原理和源码而写的最小实现。不生产可用,只做教学可用。

从零实现 [Pinia](https://github.com/vuejs/pinia)(Vue 3 + TypeScript),镜像官方架构;
与官方 **pinia 4.1.0** 的行为逐一**对拍**(tests/parity.spec.ts,以官方为唯一基准)。
中文原理文档见 [docs/](docs/README.md)(M5 里程碑补齐)。

## 运行

```bash
npm install        # 本机代理失效:务必 env -u http_proxy -u https_proxy \
                   #   -u HTTP_PROXY -u HTTPS_PROXY npm install
npm run probe      # 官方 pinia 行为探测基线(实现前先跑,只断言官方)
npm test           # vitest 单元测试 + 与官方对拍
npm run dev        # Vite demo(localhost:5173)
npm run build      # 库产物 dist/(tsc)+ demo 产物 dist-demo/(vite)
```

## 功能对照(官方 4.1 vs mini)

| 功能 | mini | 说明 |
| --- | --- | --- |
| defineStore(options / setup 语法) | ✅ | 两种语法归一为同一条创建管线 |
| state / getters / actions | ✅ | 响应式 state、computed 缓存 getter、this 绑定 action |
| $patch / $reset / $subscribe / $onAction / $dispose | ✅ | 事件语义与官方对拍一致 |
| storeToRefs / mapState / mapGetters / mapActions / mapWritableState | ✅ | 选项式 API 辅助齐 |
| 插件系统 pinia.use | ✅ | 上下文四件套 + 返回值铺 store |
| devtools / HMR / SSR 深支持 / mapStores | ⛔ 见 docs/06 | 简化点诚实清单 |

## 里程碑

- [x] M1 脚手架(配置 + 官方行为探测基线)
- [x] M2 createPinia + defineStore 核心(两种语法归一 + 按需展开 + 插件执行)
- [ ] M3 操作 API($patch/$reset/$subscribe/$onAction/$dispose)
- [ ] M4 storeToRefs + mapXxx + 插件系统
- [ ] M5 examples + docs + 发布