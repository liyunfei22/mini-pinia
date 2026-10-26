/**
 * subscriptions —— 订阅容器(Set)与统一触发器
 * 对应官方:packages/pinia/src/subscriptions.ts
 * 教学点:
 * 1. v2 用数组管订阅、去重靠手动 indexOf → v4.1 直接用 Set:天然去重,
 *    重复注册同一回调会被顶层 $subscribe 直接拦截(诊断码 PINIA_R1007);
 * 2. 非 detached 的订阅注册时挂 onScopeDispose:组件/effectScope 卸载自动解绑,
 *    这是「组件卸载后订阅不再触发」的实现根;detached:true 跳过;
 * 3. `subscriptions.delete(callback) && onCleanup()` —— delete 返回 true
 *    (确实删掉了)才执行清理回调的短路写法。
 */
import { getCurrentScope, onScopeDispose } from 'vue'
import { noop } from './utils'

/**
 * 往订阅集合注册回调,返回移除函数。
 * @param subscriptions 订阅集合
 * @param callback      回调(Set 保证同一引用只注册一次)
 * @param detached      true:不受所在 effectScope 卸载影响(如组件卸载后仍要存活)
 * @param onCleanup     移除订阅时执行的清理(如停掉 watcher)
 */
export function addSubscription<T extends (...args: any[]) => any>(
  subscriptions: Set<T>,
  callback: T,
  detached: boolean,
  onCleanup: () => void = noop,
): () => void {
  subscriptions.add(callback)
  const removeSubscription = () => {
    // delete 返回 true(确实删掉了)才执行 onCleanup
    subscriptions.delete(callback) && onCleanup()
  }
  if (!detached && getCurrentScope()) onScopeDispose(removeSubscription)
  return removeSubscription
}

/** 按插入顺序向所有订阅者广播(Set.forEach 保证插入序;forEach 中删除是安全的) */
export function triggerSubscriptions<T extends (...args: any[]) => any>(
  subscriptions: Set<T>,
  ...args: Parameters<T>
): void {
  subscriptions.forEach((callback) => {
    callback(...args)
  })
}