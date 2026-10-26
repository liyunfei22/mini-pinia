/**
 * plugin —— logger 插件(pinia.use 注册)
 * 每次 store 创建时:
 * 1. 记录 {id, time, actionCount} 到模块级 createdLogs(供面板 ⑧ 展示);
 * 2. 控制台输出 '[mini-pinia demo] store created: <id>';
 * 3. 用 Object.defineProperty 向 store 注入「只读」扩展属性 $createdAt(时间串)
 *    与 $pluginId(插件实例序号)—— 只读介于「注入扩展」教学点:直接 return
 *    对象会被 assign 铺到 store 上(可覆盖),defineProperty 则不可写。
 * 注意:actionCount 取自 context.options.actions —— mini-pinia 在插件执行前
 * 已把两种语法(含 setup 语法)的原始 action 函数收集进 options.actions。
 */
import type { PiniaPlugin, PiniaPluginContext } from '@mini/index'

/** 一次 store 创建的记录(面板 ⑧ 展示用) */
export interface StoreCreatedLog {
  id: string
  time: string
  actionCount: number
}

/** 全部创建记录(按创建顺序) */
export const createdLogs: StoreCreatedLog[] = []

/** 插件实例序号(每个 store 创建时 +1,$pluginId 就带它) */
let pluginSeq = 0

/** logger 插件本体 */
export const loggerPlugin: PiniaPlugin = (context: PiniaPluginContext): void => {
  const { store, options } = context

  // options.actions 里是「包装前」的原始 action 函数(两种语法都已收集)
  const actionCount = Object.keys((options as { actions?: unknown }).actions ?? {}).length
  const time = new Date().toLocaleTimeString('zh-CN')

  createdLogs.push({ id: store.$id, time, actionCount })
  console.log(`[mini-pinia demo] store created: ${store.$id}`)

  // 注入只读扩展属性(直接 return 会被 assign 覆盖,做不到只读)
  Object.defineProperty(store, '$createdAt', {
    value: time,
    writable: false,
    enumerable: true,
  })
  Object.defineProperty(store, '$pluginId', {
    value: `logger#${++pluginSeq}`,
    writable: false,
    enumerable: true,
  })
}