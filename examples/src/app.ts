/**
 * app —— mini-pinia 教学演示主面板(全部 h() 渲染函数 + setup,无 SFC / 无 router,中文 UI)
 * 十区:① 两个 store ② getter 缓存可视化 ③ $patch 双形态 ④ $subscribe 日志
 * ⑤ $onAction 日志(after/onError 分色) ⑥ 跨 store action ⑦ $reset
 * ⑧ 插件演示 ⑨ storeToRefs vs 直接解构 ⑩ Options-API 组件
 */
import { defineComponent, h, ref, type VNode } from 'vue'
import {
  getActivePinia,
  mapActions,
  mapState,
  mapWritableState,
  storeToRefs,
} from '@mini/index'
import { createdLogs } from './plugin'
import { getDoubleEvalCount, useCartStore, useCounterStore } from './stores'

// ------------------------------ 样式与小组件 ------------------------------
const SEC = 'background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin-bottom:16px;'
const TITLE = 'margin:0 0 10px;font-size:15px;color:#111827;'
const LABEL = 'margin:6px 0;font-size:13px;color:#374151;'
const BIG = 'font-size:20px;color:#2563eb;margin:0 4px;'
const BTN = 'margin-right:8px;padding:5px 14px;border:none;border-radius:6px;font-size:13px;color:#fff;cursor:pointer;'

/** 卡片外壳:标题 + 内容 */
const sec = (t: string, ...c: any[]): VNode =>
  h('section', { style: SEC }, [h('h2', { style: TITLE }, t), ...c])
/** 按钮:color 决定底色(红=危险,紫=异步,绿=成功,灰=次要) */
const btn = (t: string, onClick: () => void, color = '#2563eb', extra = '') =>
  h('button', { onClick, style: BTN + `background:${color};` + extra }, t)

// ------------------------ ⑨ storeToRefs vs 直接解构 ------------------------
/** ⑨-1 直接解构:count 是 setup 时的一次性「数字快照」,渲染永不更新 */
const DestructureDemo = defineComponent({
  setup() {
    const { count } = useCounterStore() // 解构当场取 .count 当前值(普通 number)
    return () =>
      h('p', { style: LABEL }, [
        '直接解构 count = ',
        h('b', { style: 'color:#b45309;' }, String(count)),
      ])
  },
})
/** ⑨-2 storeToRefs 解构:拿到与 store 双向同步的 ref,跟随变化 */
const RefsDemo = defineComponent({
  setup() {
    const { count: rCount } = storeToRefs(useCounterStore())
    return () =>
      h('p', { style: LABEL }, [
        'storeToRefs count = ',
        h('b', { style: 'color:#166534;' }, String(rCount.value)),
      ])
  },
})

// ------------------- ⑩ Options-API 组件(mapXxx 全家桶) -------------------
const OptionsApiDemo = defineComponent({
  computed: {
    ...mapState(useCounterStore, ['count', 'double']), // state/getter → computed
    ...mapWritableState(useCounterStore, { c: 'count' }), // 可写描述符 → v-model
  },
  methods: {
    ...mapActions(useCounterStore, ['inc', 'fail']), // action → methods
  },
  render() {
    const vm = this as any
    return h(
      'div',
      { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' },
      [
        h('span', { style: 'font-size:13px;' }, [
          'count = ', h('b', {}, String(vm.count)),
          ' , double = ', h('b', {}, String(vm.double)),
        ]),
        h('input', {
          value: vm.c, // v-model 风格:value 绑定 + onInput 写回 store
          style: 'width:90px;padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;',
          onInput: (e: Event) => { vm.c = Number((e.target as HTMLInputElement).value) || 0 },
        }),
        btn('+1 (inc)', () => vm.inc(1)),
        btn('故意失败 (fail)', () => vm.fail(), '#dc2626'),
      ],
    )
  },
})

// -------------------------------- 主面板 ---------------------------------
interface SubEntry { time: string; type: string; storeId: string; isPatch: boolean; payload: string | null }
interface ActionEntry { time: string; name: string; kind: 'after' | 'error'; detail: string }

export const App = defineComponent({
  name: 'MiniPiniaDemo',
  setup() {
    const counter = useCounterStore()
    const cart = useCartStore()
    const pinia = getActivePinia() // 插件上下文:当前激活的 pinia(getActivePinia)
    // 插件注入的只读属性不在 Store 类型上,用最小形状桥接
    const px = {
      counter: counter as unknown as { $createdAt: string; $pluginId: string },
      cart: cart as unknown as { $createdAt: string; $pluginId: string },
    }

    // ---- ③④ $subscribe(counter + cart):记录最近 10 条 ----
    /** 毫秒级时间戳(慢 action 的 600ms 时序差才能被肉眼观察到) */
    const fmtTime = (): string => {
      const d = new Date()
      return `${d.toLocaleTimeString('zh-CN')}.${String(d.getMilliseconds()).padStart(3, '0')}`
    }
    const subLog = ref<SubEntry[]>([])
    const latest = ref<SubEntry | null>(null) // ③ 的「最近一次事件」行
    const recSub = (m: any): void => {
      const e: SubEntry = {
        time: fmtTime(),
        type: m.type, storeId: m.storeId,
        isPatch: m.type !== 'direct',
        payload: 'payload' in m ? JSON.stringify(m.payload) : null,
      }
      latest.value = e
      subLog.value.push(e)
      if (subLog.value.length > 10) subLog.value.shift()
    }
    counter.$subscribe((m) => recSub(m))
    cart.$subscribe((m) => recSub(m))

    // ---- ⑤ $onAction:after / onError 分色日志(最近 8 条) ----
    const actionLog = ref<ActionEntry[]>([])
    const recAction = (name: string, kind: ActionEntry['kind'], d: any): void => {
      actionLog.value.push({
        time: fmtTime(), name, kind,
        detail: d instanceof Error ? `Error: ${d.message}` : String(d),
      })
      if (actionLog.value.length > 8) actionLog.value.shift()
    }
    const hookActions = (store: any): void => {
      store.$onAction((ctx: any) => {
        ctx.after((res: any) => recAction(ctx.name, 'after', res))
        ctx.onError((err: any) => recAction(ctx.name, 'error', err))
      })
    }
    hookActions(counter)
    hookActions(cart) // 跨 store 的 inc 也会以 counter 身份出现在日志

    // ---- 交互 handler ----
    const slowRunning = ref(false)
    const readTip = ref('')
    const runSlowInc = async (): Promise<void> => {
      if (slowRunning.value) return // 重入守卫:600ms 窗口内重复点击不再并发执行
      slowRunning.value = true
      try { await counter.slowInc(2) } finally { slowRunning.value = false }
    }
    const readGetterOnly = (): void => {
      void counter.double // 命中缓存:getter 函数体不执行,求值计数不变
      readTip.value = `${fmtTime()} 已读取 double —— 缓存命中,未触发重算`
    }
    const tryFail = (fn: () => unknown): void => {
      try { fn() } catch { /* 错误已由 onError 记入日志(异常仍被原样抛出) */ }
    }

    // ---- 渲染 ----
    return () =>
      h(
        'div',
        {
          style: 'max-width:960px;margin:0 auto;padding:24px 16px;' +
            'font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#111827;',
        },
        [
          h('header', { style: 'margin-bottom:18px;' }, [
            h('h1', { style: 'margin:0 0 4px;font-size:22px;' }, 'mini-pinia 教学演示'),
            h('p', { style: 'margin:0;color:#6b7280;font-size:13px;' },
              '十区演示:getter 缓存 / $patch / $subscribe / $onAction / 跨 store / $reset / 插件 / storeToRefs / Options-API'),
          ]),

          // ① 两个 store:options 语法计数器 + setup 语法购物车(double 与 total)
          sec('① 两个 store:options 语法计数器 + setup 语法购物车',
            h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;' }, [
              h('div', { style: 'flex:1;min-width:280px;background:#f9fafb;border-radius:8px;padding:12px 14px;' }, [
                h('p', { style: LABEL }, [`${counter.title}当前值 `, h('b', { style: BIG }, String(counter.count)), ' , getter double = ', h('b', { style: BIG }, String(counter.double))]),
                h('div', {}, [
                  btn('+1 (inc)', () => counter.inc(1)),
                  btn('异步 +2 (slowInc)', runSlowInc, '#7c3aed', slowRunning.value ? 'opacity:.5;cursor:not-allowed;' : ''),
                  btn('$reset', () => counter.$reset(), '#6b7280'),
                ]),
                h('p', { style: 'font-size:12px;color:#9ca3af;margin:10px 0 0;' }, ['history 最近 3 条:', counter.history.slice(-3).join('　') || '无']),
              ]),
              h('div', { style: 'flex:1;min-width:280px;background:#f9fafb;border-radius:8px;padding:12px 14px;' }, [
                h('p', { style: LABEL }, ['购物车商品 ', h('b', { style: BIG }, String(cart.items.length)), ' 件 , computed 总价 total = ', h('b', { style: BIG }, `¥${cart.total}`)]),
                h('ul', { style: 'margin:6px 0 10px;padding-left:18px;font-size:13px;color:#374151;' },
                  cart.items.map((it) => h('li', {}, `${it.name} ×${it.qty} = ¥${it.price * it.qty}`))),
                h('div', {}, [btn('加购一件 (addItem)', () => cart.addItem())]),
              ]),
            ]),
          ),

          // ② getter 缓存:double 求值计数
          sec('② getter 缓存可视化(double 求值计数)',
            h('p', { style: LABEL }, ['double 已求值 ', h('b', { style: 'color:#7c3aed;font-size:15px;' }, String(getDoubleEvalCount())), ' 次 —— 每次真正重算 +1,只读缓存不加']),
            h('p', { style: 'font-size:13px;color:#374151;margin:4px 0;' }, [`当前 count = ${counter.count} , double = ${counter.double}`]),
            h('div', {}, [btn('+1(触发重算)', () => counter.inc(1)), btn('只读 getter(命中缓存)', readGetterOnly, '#6b7280')]),
            readTip.value
              ? h('p', { style: 'font-size:12px;color:#0d9488;margin:8px 0 0;' }, readTip.value)
              : h('p', { style: 'font-size:12px;color:#9ca3af;margin:6px 0;' }, '提示:首帧渲染已求值 1 次;连点「只读 getter」计数不动(依赖不变 → 命中缓存);任何面板改动 count 都会让计数 +1(依赖变了才重算)—— 这就是 computed 缓存语义。'),
          ),

          // ③ $patch 双形态 + 最近一次订阅事件
          sec('③ $patch 双形态(对象 / 函数)',
            h('div', {}, [
              btn('$patch({ count: +1 }) 对象形态', () => counter.$patch({ count: counter.count + 1 })),
              btn('$patch(s => s.count += 1) 函数形态', () => counter.$patch((s: any) => { s.count += 1 }), '#0d9488'),
            ]),
            h('p', { style: LABEL }, latest.value
              ? ['最近一次订阅事件:', h('b', { style: 'color:#2563eb;' }, String(latest.value.type)),
                ` | storeId: ${latest.value.storeId} | 由 $patch 发起:${latest.value.isPatch ? '是' : '否'}`]
              : '暂无订阅事件(先点上方按钮试试)'),
          ),

          // ④ $subscribe 日志面板(最近 10 条)
          sec('④ $subscribe 订阅日志(counter + cart,最近 10 条)',
            subLog.value.length === 0
              ? h('p', { style: 'font-size:12px;color:#9ca3af;margin:6px 0;' }, '暂无订阅事件:任何 state 变更(direct / patch)都会出现在这里')
              : [
                  h('p', { style: 'margin:0 0 4px;font-size:12px;color:#6b7280;' }, '时间 | 类型 | storeId | 是否 patch | payload'),
                  h('ul', { style: 'list-style:none;margin:0;padding:0;font-size:12px;font-family:monospace;' },
                    subLog.value.slice().reverse().map((e) =>
                      h('li', { style: 'padding:3px 6px;border-bottom:1px dashed #e5e7eb;' }, [
                        e.time, ' | ',
                        h('b', { style: 'color:' + (e.type.startsWith('patch') ? '#0d9488' : '#6b7280') }, e.type),
                        ` | ${e.storeId} | ${e.isPatch ? '是' : '否'}`, e.payload ? ` | ${e.payload}` : '',
                      ]))),
                ],
          ),

          // ⑤ $onAction 日志(after 绿 / onError 红)
          sec('⑤ $onAction 日志(after 绿 / onError 红)',
            h('div', {}, [
              btn('inc 正常 action', () => counter.inc(1)),
              btn('slowInc 异步 action(看 after 时序)', runSlowInc, '#7c3aed'),
              btn('counter.fail 故意失败', () => tryFail(counter.fail), '#dc2626'),
              btn('cart.fail 故意失败', () => tryFail(cart.fail), '#dc2626'),
            ]),
            actionLog.value.length === 0
              ? h('p', { style: 'font-size:12px;color:#9ca3af;margin:6px 0;' }, '暂无 action 日志:点上方按钮,after / onError 会分色记录')
              : h('ul', { style: 'list-style:none;margin:8px 0 0;padding:0;font-size:12px;font-family:monospace;' },
                  actionLog.value.slice().reverse().map((e) =>
                    h('li', { style: `padding:3px 6px;color:${e.kind === 'error' ? '#dc2626' : '#166534'};` }, [
                      `[${e.time}] ${e.kind === 'error' ? 'onError →' : 'after →'} ${e.name} : `, h('b', {}, String(e.detail)),
                    ]))),
            h('p', { style: 'font-size:12px;color:#9ca3af;margin:8px 0 0;' },
              '提示:slowInc 的 after 在其 600ms 延迟落定后才出现(看日志毫秒戳,相差约 600ms);点下方「checkout」时 inc 会以 counter 身份再记一条 —— 跨 store 调用同样可被 $onAction 观察。'),
          ),

          // ⑥ 跨 store action
          sec('⑥ 跨 store action(cart.checkout → counter.inc)',
            h('div', {}, [btn('cart.checkout() —— 内部调用 counter.inc()', () => cart.checkout(), '#059669')]),
            h('p', { style: LABEL }, [`数值联动:count = ${counter.count} , 购物车 = ${cart.items.length} 件(checkout 把商品件数加给计数器)`]),
          ),

          // ⑦ $reset
          sec('⑦ $reset(复原为初始 state)',
            h('div', {}, [btn('counter.$reset()', () => counter.$reset(), '#6b7280')]),
            h('p', { style: 'font-size:13px;color:#374151;' },
              `当前 count = ${counter.count} , history 有 ${counter.history.length} 条 —— 点上方按钮后回到 count=0、history 清空(options 语法专属:内部是一次函数形态 $patch,订阅面板会多一条 patch function)`),
          ),

          // ⑧ 插件演示:注入属性 + 上下文信息
          sec('⑧ 插件演示(logger 插件注入与上下文)',
            h('table', { style: 'border-collapse:collapse;width:100%;margin-bottom:8px;' },
              [['store', '$createdAt', '$pluginId'], ['counter', px.counter.$createdAt, px.counter.$pluginId], ['cart', px.cart.$createdAt, px.cart.$pluginId]].map((row, ri) =>
                h('tr', {}, row.map((cell) =>
                  h(ri === 0 ? 'th' : 'td',
                    { style: 'border:1px solid #e5e7eb;padding:4px 10px;text-align:left;font-size:12px;font-family:monospace;' },
                    String(cell)))))),
            h('p', { style: 'font-size:12px;color:#374151;margin:6px 0 4px;' }, '创建记录(控制台同步输出 [mini-pinia demo] store created: ···):'),
            h('ul', { style: 'list-style:none;margin:0 0 8px;padding:0;font-size:12px;font-family:monospace;' },
              createdLogs.map((l) => h('li', {}, `[${l.time}] ${l.id}(actions: ${l.actionCount})`))),
            h('p', { style: 'font-size:12px;color:#6b7280;' }, [
              '插件上下文:getActivePinia() 拿到的 pinia,注册表 _s 现有门店:',
              h('b', {}, pinia ? [...pinia._s.keys()].join('、') : '—'),
              ';options.actions 里是包装前的原始 action 函数(actionCount 的由来)。',
            ]),
          ),

          // ⑨ storeToRefs vs 直接解构
          sec('⑨ storeToRefs vs 直接解构(响应性对比)',
            h('div', { style: 'margin-bottom:8px;' }, [btn('修改 store.count(+1)', () => counter.inc(1))]),
            h('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;' }, [
              h('div', { style: 'flex:1;min-width:240px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;' }, [
                h('p', { style: 'margin:0;font-size:13px;font-weight:600;color:#9a3412;' }, 'const { count } = store(解构即快照)'),
                h(DestructureDemo),
              ]),
              h('div', { style: 'flex:1;min-width:240px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;' }, [
                h('p', { style: 'margin:0;font-size:13px;font-weight:600;color:#15803d;' }, 'const { count } = storeToRefs(store)(引用,保持同步)'),
                h(RefsDemo),
              ]),
            ]),
            h('p', { style: 'font-size:12px;color:#9ca3af;margin:8px 0 0;' }, '点「修改 store.count(+1)」:解构组永远是创建时的旧值,refs 组跟随变化。'),
          ),

          // ⑩ Options-API 组件
          sec('⑩ Options-API 组件(mapState / mapWritableState / mapActions)',
            h(OptionsApiDemo),
            h('p', { style: 'font-size:12px;color:#9ca3af;margin-top:8px;' },
              '输入框经 mapWritableState({ c: "count" }) 双向写 store.count(v-model 风格);按钮走 mapActions 的 inc / fail —— 数据同样出现在上方日志里,因为用的是同一个 counter store。'),
          ),

          h('footer', { style: 'font-size:12px;color:#9ca3af;text-align:center;margin-top:8px;' },
            '本 demo 只 import vue 与 @mini/index —— mini-pinia 自身实现的运行证明。'),
        ],
      )
  },
})