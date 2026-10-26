/**
 * probes —— 官方 pinia 4.1.0 行为探测脚本(只断言官方,不涉及 mini)
 * ==============================================================
 * 方法论:实现任何 mini 模块之前,先用本脚本把官方边界行为钉死
 * (行为以官方为唯一基准,不凭记忆猜)。探测结论沉淀进 docs/06 对照表。
 *
 * 用法:npm run probe
 * 约定:
 * - 每条探测独立 createPinia + setActivePinia,结束后 disposePinia(隔离 activePinia);
 * - 断言只描述「官方确实如此」,供 mini 实现追随;若某条失败 = 官方版本行为变化,
 *   以实际版本为准重新沉淀结论。
 */
import {
  createPinia,
  defineStore,
  disposePinia,
  getActivePinia,
  setActivePinia,
  storeToRefs,
  MutationType,
} from 'pinia'
import { computed, effectScope, nextTick, reactive, ref, toRaw } from 'vue'

const results = []
const tasks = []

async function runProbe(name, fn) {
  try {
    await fn()
    results.push(['✅', name])
  } catch (err) {
    results.push(['❌', name, err instanceof Error ? err.message : String(err)])
  }
}

/** 收集探测任务(真正执行推迟到文件末尾统一 await,保证输出顺序与退出码正确) */
function probe(name, fn) {
  tasks.push(runProbe(name, fn))
}

/** 新建独立 pinia 并激活;结束自动 dispose + 清空模块级 activePinia */
async function withPinia(fn) {
  const pinia = createPinia()
  setActivePinia(pinia)
  try {
    await fn(pinia)
  } finally {
    disposePinia(pinia)
    setActivePinia(undefined)
  }
}

/** 屏蔽 console 噪音(探测会故意触发警告),返回收集结果与恢复函数 */
function silenceConsole(method = 'warn') {
  const orig = console[method]
  const calls = []
  console[method] = (...args) => calls.push(args.join(' '))
  return { calls, restore: () => (console[method] = orig) }
}

// ---- 数据层:$state 与 pinia.state 的关系 ----

probe('01 $state === pinia.state.value[id] 恒等', () =>
  withPinia((pinia) => {
    const useStore = defineStore('a', { state: () => ({ count: 0 }) })
    const store = useStore()
    if (store.$state !== pinia.state.value.a) throw new Error('identity mismatch')
  }),
)

probe('02 toRaw($state) === toRaw(pinia.state.value[id])', () =>
  withPinia((pinia) => {
    const useStore = defineStore('b', { state: () => ({ count: 0 }) })
    const store = useStore()
    if (toRaw(store.$state) !== toRaw(pinia.state.value.b)) throw new Error('toRaw mismatch')
  }),
)

probe('03 store 上临时属性不进 $state(按需展开)', () =>
  withPinia((pinia) => {
    const useStore = defineStore('c', { state: () => ({ count: 0 }) })
    const store = useStore()
    store.temp = 123
    if (store.temp !== 123) throw new Error('temp not readable on store')
    if (pinia.state.value.c.temp !== undefined) throw new Error('temp leaked into $state')
  }),
)

// ---- $patch:事件计数与语义 ----

probe('04 $patch(对象):恰 1 次同步 patch object 事件 + payload + 深合并 + 不补发', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('d', { state: () => ({ count: 0, nested: { a: 1 } }) })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push({ type: m.type, hasPayload: 'payload' in m, c: store.count }))
    store.$patch({ count: 5, nested: { b: 2 } })
    if (events.length !== 1) throw new Error(`events=${events.length}`)
    if (events[0].type !== 'patch object' || !events[0].hasPayload) throw new Error('载荷不对')
    // 深合并:兄弟键 a 保留 + 新键 b 出现
    if (store.nested.a !== 1 || store.nested.b !== 2) throw new Error('deep merge failed')
    if (store.count !== 5) throw new Error('count not patched')
    // 等下一轮微任务:watcher 不应再补发 direct 事件(activeListener 门控)
    await nextTick()
    if (events.length !== 1) throw new Error(`watcher leaked event: ${events.length}`)
  }),
)

probe('05 $patch(函数):恰 1 次同步 patch function 事件 + 无 payload', () =>
  withPinia((pinia) => {
    const useStore = defineStore('e', { state: () => ({ count: 0, nested: { a: 1 } }) })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push({ type: m.type, hasPayload: 'payload' in m }))
    store.$patch((s) => {
      s.count = 7
      s.nested.a = 9
    })
    if (events.length !== 1) throw new Error(`events=${events.length}`)
    if (events[0].type !== 'patch function' || events[0].hasPayload) throw new Error('载荷不对')
    if (store.count !== 7 || store.nested.a !== 9) throw new Error('patch fn not applied')
  }),
)

// ---- $subscribe:flush 时序 ----

probe('07 直接变更默认 flush:同步 0 事件,nextTick 后 1 次 direct', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('f', { state: () => ({ count: 0 }) })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push(m.type))
    store.count++
    if (events.length !== 0) throw new Error(`sync events=${events.length}`)
    await nextTick()
    if (events.length !== 1 || events[0] !== 'direct') throw new Error(`after tick: ${events.join(',')}`)
  }),
)

probe('08 flush:sync 直接变更立即触发;$patch 不双发', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('g', { state: () => ({ count: 0 }) })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push(m.type), { flush: 'sync' })
    store.count++
    if (events.length !== 1 || events[0] !== 'direct') throw new Error(`1: ${events.join(',')}`)
    store.$patch({ count: 9 })
    if (events.length !== 2 || events[1] !== 'patch object') throw new Error(`2: ${events.join(',')}`)
    await nextTick()
    if (events.length !== 2) throw new Error(`leak: ${events.length}`)
  }),
)

probe('09 deep 默认开启:嵌套属性变更也触发 direct', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('h', { state: () => ({ nested: { a: 1 } }) })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push(m.type))
    store.nested.a = 2
    await nextTick()
    if (events.length !== 1 || events[0] !== 'direct') throw new Error(events.join(','))
  }),
)

// ---- $reset ----

probe('10 $reset:恰 1 次 patch function 事件 + 状态复原', () =>
  withPinia((pinia) => {
    const useStore = defineStore('i', {
      state: () => ({ count: 1, s: 'x' }),
      actions: {},
    })
    const store = useStore()
    const events = []
    store.$subscribe((m) => events.push(m.type))
    store.count = 42
    store.s = 'y'
    store.$reset()
    if (store.count !== 1 || store.s !== 'x') throw new Error('state not reset')
    if (events.length !== 1 || events[0] !== 'patch function') throw new Error(events.join(','))
  }),
)

probe('10b setup 语法 store 调 $reset 抛错(dev)', () =>
  withPinia((pinia) => {
    const useStore = defineStore('i2', () => ({ count: ref(0) }))
    const store = useStore()
    let threw = false
    try {
      store.$reset()
    } catch {
      threw = true
    }
    if (!threw) throw new Error('expected throw on setup store $reset')
  }),
)

// ---- $patch 深合并细节 ----

probe('11 $patch 新增键进 $state,但 store 上不可见(不动态展开)', () =>
  withPinia((pinia) => {
    const useStore = defineStore('j', { state: () => ({ count: 0 }) })
    const store = useStore()
    store.$patch({ brandNew: 1 })
    if (pinia.state.value.j.brandNew !== 1) throw new Error('key missing in $state')
    if (store.brandNew !== undefined) throw new Error('store exposes un-declared key')
  }),
)

// ---- getter 缓存 ----

probe('12 getter 缓存:依赖未变只求值一次,变更后惰性重算', () =>
  withPinia((pinia) => {
    let computedCount = 0
    const useStore = defineStore('k', {
      state: () => ({ count: 0 }),
      getters: {
        double(state) {
          computedCount++
          return state.count * 2
        },
      },
    })
    const store = useStore()
    if (store.double !== 0 || store.double !== 0 || store.double !== 0) throw new Error('值错')
    if (computedCount !== 1) throw new Error(`computed ran ${computedCount} times`)
    store.count = 3
    if (store.double !== 6) throw new Error('未重算')
    if (computedCount !== 2) throw new Error(`after change ran ${computedCount} times`)
  }),
)

// ---- $onAction ----

probe('13 $onAction 载荷 {name, args, store, after, onError}', () =>
  withPinia((pinia) => {
    const useStore = defineStore('l', {
      state: () => ({ n: 0 }),
      actions: { inc(step = 1) { this.n += step; return this.n } },
    })
    const store = useStore()
    let ctx = null
    store.$onAction((c) => { ctx = c })
    store.inc(1)
    if (!ctx) throw new Error('no ctx')
    if (ctx.name !== 'inc' || ctx.args[0] !== 1 || ctx.store !== store) throw new Error('shape')
    if (typeof ctx.after !== 'function' || typeof ctx.onError !== 'function') throw new Error('hooks missing')
  }),
)

probe('14a 同步 action:after 同步触发并拿到返回值', () =>
  withPinia((pinia) => {
    const useStore = defineStore('m', { actions: { sync() { return 7 } } })
    const store = useStore()
    const log = []
    store.$onAction((c) => c.after((r) => log.push('after:' + r)))
    const r = store.sync()
    if (r !== 7) throw new Error('return missing')
    if (log.length !== 1 || log[0] !== 'after:7') throw new Error(log.join(','))
  }),
)

probe('14b 异步 action:resolve → after;reject → onError 且原样 re-reject', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('n', {
      actions: {
        async ok() { return 9 },
        async bad() { throw new Error('boom') },
      },
    })
    const store = useStore()
    const log = []
    store.$onAction((c) => {
      c.after((r) => log.push('after:' + r))
      c.onError((e) => log.push('onError:' + e.message))
    })
    await store.ok()
    if (log[0] !== 'after:9') throw new Error(log.join(','))
    let caught = null
    try { await store.bad() } catch (e) { caught = e }
    if (!caught || caught.message !== 'boom') throw new Error('error swallowed or changed')
    if (log[1] !== 'onError:boom') throw new Error(log.join(','))
  }),
)

probe('15 $onAction 的 args 与 action 共享同一数组(hook 改 args 影响实参)', () =>
  withPinia((pinia) => {
    const useStore = defineStore('o', { actions: { echo(x) { return x } } })
    const store = useStore()
    store.$onAction((c) => { c.args[0] = 999 })
    if (store.echo(1) !== 999) throw new Error('args 未共享')
  }),
)

// ---- wrapAction 的 this ----

probe('16 wrapAction this:直接/解构/跨 store/call 外来 this 都落回自己 store', () =>
  withPinia((pinia) => {
    const useA = defineStore('p1', { state: () => ({ n: 1 }), actions: { who() { return this.$id } } })
    const useB = defineStore('p2', { state: () => ({ m: 1 }), actions: { who() { return this.$id }, callA() { return useA().who() } } })
    const a = useA()
    const b = useB()
    const { who } = a
    if (a.who() !== 'p1') throw new Error('直接调用')
    if (who() !== 'p1') throw new Error('解构调用 this 丢失')
    if (b.callA() !== 'p1') throw new Error('跨 store')
    if (a.who.call({ $id: 'hacked' }) !== 'p1') throw new Error('call 外来 this 被采纳')
  }),
)

// ---- storeToRefs ----

probe('17 storeToRefs:ref→ref / computed→computed ref / reactive→ref / 函数跳过', () =>
  withPinia((pinia) => {
    const useStore = defineStore('q', () => {
      const count = ref(0)
      const self = reactive({ w: 1 })
      const double = computed(() => count.value * 2)
      function act() {}
      return { count, self, double, act }
    })
    const store = useStore()
    const refs = storeToRefs(store)
    if (!('count' in refs) || !('double' in refs) || !('self' in refs)) throw new Error('缺键')
    if ('act' in refs) throw new Error('函数不应被收编')
    store.count = 5
    if (refs.count.value !== 5) throw new Error('ref 未跟随')
    if (refs.double.value !== 10) throw new Error('computed ref 未跟随')
    store.self.w = 9
    if (refs.self.value.w !== 9) throw new Error('reactive→ref 未跟随')
  }),
)

// ---- $dispose 与生命周期 ----

probe('18 $dispose:_s 移除、state 保留、二次调用无害', () =>
  withPinia((pinia) => {
    const useStore = defineStore('r', { state: () => ({ count: 1 }) })
    const store = useStore()
    store.count = 5
    store.$dispose()
    if (pinia._s.has('r')) throw new Error('仍在 _s')
    if (pinia.state.value.r.count !== 5) throw new Error('state 被删')
    store.$dispose()
  }),
)

probe('19 dispose 后重建同 id:旧状态保留、state() 不再执行', () =>
  withPinia((pinia) => {
    let stateRuns = 0
    const useStore = defineStore('s', {
      state: () => { stateRuns++; return { count: 1 } },
    })
    const s1 = useStore()
    s1.count = 5
    s1.$dispose()
    const s2 = useStore()
    if (s2.count !== 5) throw new Error('初始状态丢失')
    if (stateRuns !== 1) throw new Error(`state() 重跑 ${stateRuns} 次`)
  }),
)

probe('20 同 id 重复 defineStore:静默复用首个 store(不报错)', () =>
  withPinia((pinia) => {
    const useA = defineStore('t', { state: () => ({ count: 1 }) })
    const useB = defineStore('t', { state: () => ({ count: 99 }) })
    const a = useA()
    const b = useB()
    if (a !== b) throw new Error('两个不同实例')
    if (a.count !== 1) throw new Error('第二个定义覆盖了状态')
  }),
)

// ---- 订阅退订与去重 ----

probe('21 $subscribe 退订:停 watcher、幂等、不影响其他订阅者', () =>
  withPinia(async (pinia) => {
    const useStore = defineStore('u', { state: () => ({ count: 0 }) })
    const store = useStore()
    const log = []
    const unsub1 = store.$subscribe(() => log.push('a'))
    const unsub2 = store.$subscribe(() => log.push('b'))
    unsub1()
    unsub1()
    store.count++
    await nextTick()
    if (log.join(',') !== 'b') throw new Error(log.join(','))
    unsub2()
  }),
)

probe('22 重复注册同一回调:告警 + 返回 noop', () =>
  withPinia((pinia) => {
    const useStore = defineStore('v', { state: () => ({ count: 0 }) })
    const store = useStore()
    const silenced = silenceConsole('warn')
    try {
      const cb = () => {}
      store.$subscribe(cb)
      const second = store.$subscribe(cb)
      if (typeof second !== 'function') throw new Error('未返回函数')
      second()
      if (silenced.calls.length === 0) throw new Error('未告警')
    } finally {
      silenced.restore()
    }
  }),
)

// ---- 插件系统 ----

probe('23 插件:app.use 前后注册顺序 + ctx 四件套 + options.actions 原始', () =>
  withPinia(async (pinia) => {
    const { createApp } = await import('vue')
    const ctxs = []
    const app = createApp({})
    pinia.use((c) => ctxs.push({ at: 'pre', app: c.app, pinia: c.pinia, id: c.store.$id, rawInc: c.options.actions?.inc?.name === 'inc' }))
    app.use(pinia)
    pinia.use((c) => ctxs.push({ at: 'post', app: c.app }))
    const useStore = defineStore('w', {
      state: () => ({}),
      actions: { inc() {} },
    })
    useStore()
    if (ctxs.length !== 2) throw new Error(`插件执行 ${ctxs.length} 次`)
    if (ctxs[0].at !== 'pre' || ctxs[1].at !== 'post') throw new Error('顺序错误')
    if (ctxs[0].app !== app || ctxs[1].app !== app) throw new Error('ctx.app 不是 app')
    if (ctxs[0].pinia !== pinia) throw new Error('ctx.pinia 不对')
    if (ctxs[0].id !== 'w' || !ctxs[0].rawInc) throw new Error('ctx.store/options 不对')
  }),
)

probe('23b 插件扩展铺到 store(ref 解包);后注册不回溯旧 store', () =>
  withPinia(async (pinia) => {
    const { createApp } = await import('vue')
    const app = createApp({})
    // 注意:use 在 install 之前注册 → 进 toBeInstalled 队列,install 时才转入 _p
    pinia.use(() => ({ $plugged: 'yes', count2: ref(10) }))
    app.use(pinia)
    const useStore = defineStore('x', { state: () => ({ count: 0 }) })
    const store = useStore()
    if (store.$plugged !== 'yes') throw new Error('扩展值缺失')
    if (store.count2 !== 10) throw new Error('ref 扩展未解包')
    const late = []
    pinia.use((c) => { late.push(c.store.$id); return { $late: 'x' } })
    const useStore2 = defineStore('x2', { state: () => ({}) })
    const s2 = useStore2()
    if (late.join(',') !== 'x2') throw new Error('后注册插件回溯:' + late.join(','))
    if (store.$late !== undefined) throw new Error('旧 store 被回溯扩展')
    if (s2.$late !== 'x') throw new Error('新 store 未收到扩展')
  }),
)

// ---- 假设求证(证伪项) ----

probe('24 可写 getter:{get,set}/函数 getter 赋值均无效 + readonly 警告(证伪)', () =>
  withPinia((pinia) => {
    const useStore = defineStore('y', {
      state: () => ({ count: 1 }),
      getters: {
        double(state) { return state.count * 2 },
      },
    })
    const store = useStore()
    const silenced = silenceConsole('warn')
    try {
      store.double = 10
    } finally {
      silenced.restore()
    }
    if (store.double !== 2 || store.count !== 1) throw new Error('可写 getter 意外生效')
    if (silenced.calls.length === 0) throw new Error('期望 Vue readonly 警告')
  }),
)

// ---- 事件载荷细节 ----

probe('25 订阅载荷键:type/storeId/events(/payload) 按类型对齐', () =>
  withPinia((pinia) => {
    const useStore = defineStore('z', { state: () => ({ count: 0 }) })
    const store = useStore()
    const got = []
    store.$subscribe((m) => got.push({ type: m.type, storeId: m.storeId, keys: Object.keys(m).sort() }), { flush: 'sync' })
    store.count = 2
    store.$patch({ count: 3 })
    store.$reset()
    if (got.length !== 3) throw new Error(`events=${got.length}`)
    const [direct, patchObj, patchFn] = got
    if (direct.type !== 'direct' || direct.keys.join(',') !== 'events,storeId,type') throw new Error('direct keys')
    if (patchObj.type !== 'patch object' || patchObj.keys.join(',') !== 'events,payload,storeId,type') throw new Error('patch obj keys')
    if (patchFn.type !== 'patch function' || patchFn.keys.join(',') !== 'events,storeId,type') throw new Error('patch fn keys')
    if (direct.storeId !== 'z' || patchObj.storeId !== 'z' || patchFn.storeId !== 'z') throw new Error('storeId')
  }),
)

// ---- 订阅者顺序 ----

probe('27 多订阅者按插入顺序触发', () =>
  withPinia((pinia) => {
    const useStore = defineStore('aa', { state: () => ({ count: 0 }) })
    const store = useStore()
    const log = []
    store.$subscribe(() => log.push('a'))
    store.$subscribe(() => log.push('b'))
    store.$patch({ count: 1 })
    if (log.join(',') !== 'a,b') throw new Error(log.join(','))
  }),
)

// ---- effectScope 关联(detached 语义的无 DOM 版) ----

probe('28 默认订阅随 effectScope 停止而移除;detached 存活', () =>
  withPinia((pinia) => {
    const useStore = defineStore('ab', { state: () => ({ count: 0 }) })
    const rootScope = effectScope(true)
    const log = []
    rootScope.run(() => {
      const store = useStore()
      store.$subscribe(() => log.push('normal'))
      store.$subscribe(() => log.push('detached'), { detached: true })
    })
    rootScope.stop()
    const store2 = useStore()
    store2.$patch({ count: 1 })
    if (log.join(',') !== 'detached') throw new Error(log.join(','))
  }),
)

// ---- getActivePinia 兜底 ----

probe('29 无 pinia 时 getActivePinia 返回 undefined 并 console.error(dev)', () => {
  setActivePinia(undefined)
  const silenced = silenceConsole('error')
  const p = getActivePinia()
  silenced.restore()
  if (p !== undefined) throw new Error('返回了非 undefined')
  if (silenced.calls.length === 0) throw new Error('未输出 dev 错误')
})

// ---- MutationType 常量 ----

probe('31 MutationType 常量值与订阅 type 一一对应', () =>
  withPinia((pinia) => {
    if (MutationType.direct !== 'direct') throw new Error('direct')
    if (MutationType.patchObject !== 'patch object') throw new Error('patchObject')
    if (MutationType.patchFunction !== 'patch function') throw new Error('patchFunction')
  }),
)

// ---- 汇总 ----

// 等待全部探测完成后再汇总(顺序输出 + 正确的退出码)
await Promise.all(tasks)

const failed = results.filter((r) => r[0] === '❌')
for (const [mark, name, err] of results) {
  console.log(`${mark} ${name}${err ? `\n     -> ${err}` : ''}`)
}
console.log(`\n共 ${results.length} 条:通过 ${results.length - failed.length},失败 ${failed.length}`)
console.log('⏳ 需 DOM/组件环境、留待 vitest 补测:$subscribe detached 在组件卸载下的表现、' +
  'mapState/mapActions 在 Options-API 组件中的 this.$pinia、flush:post 订阅在渲染后的时序。')

process.exitCode = failed.length > 0 ? 1 : 0