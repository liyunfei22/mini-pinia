/**
 * utils —— 基础工具函数
 * 对应官方:packages/pinia/src/utils.ts(以及官方 types.ts 里的 isPlainObject/isComputed)
 * 教学点:
 * 1. isPlainObject 的 toJSON 检查:带 toJSON 方法的对象(如 Day.js 日期)会被 Vue
 *    序列化为字符串,官方宁可判为「非纯对象」避免深度合并出错;
 * 2. mergeReactiveObjects 是 $patch(对象形式)的深合并引擎:Map/Set 走增量、
 *    纯对象递归合并,合并后若目标是浅层 ref(shallowRef)要手动 triggerRef 通知。
 */
import { isRef, isReactive, isShallow, toRaw, triggerRef } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { StateTree } from './types'

/** 空函数($subscribe 重复注册时返回、addSubscription 的默认 onCleanup) */
export const noop = () => {}

/** 纯对象判定(与官方逐行一致):存在、Object 标签、且没有 toJSON 方法 */
export function isPlainObject(o: any): o is Record<string, any> {
  return (
    o &&
    typeof o === 'object' &&
    Object.prototype.toString.call(o) === '[object Object]' &&
    typeof o.toJSON !== 'function'
  )
}

/** computed 判定:是 ref 且带 effect(computed 的 ref 上挂着 effect;!! 与官方 4.1 一致) */
export function isComputed<T>(o: any): o is ComputedRef<T> {
  return !!(isRef(o) && (o as any).effect)
}

/**
 * 深合并 patchToApply 到 target($patch 对象形式的引擎):
 * - Map/Set 各自走 set/add 增量更新;
 * - 双方都是纯对象、且 target 自身已有所键 → 递归合并;新键直接赋值;
 * - 递归合并处若目标键是浅层 ref(shallowRef),手动 triggerRef 通知依赖刷新。
 */
export function mergeReactiveObjects<T extends StateTree>(target: T, patchToApply: any): T {
  // 局部别名:绕开「泛型 T 只能读不能写索引」的 TS 限制(2862),与官方 JS 行为一致
  const t: any = target

  // Map/Set 只做逐项更新(Set.add 需要显式绑定 this)
  if (t instanceof Map && patchToApply instanceof Map) {
    patchToApply.forEach((value, key) => t.set(key, value))
  } else if (t instanceof Set && patchToApply instanceof Set) {
    patchToApply.forEach(t.add, t)
  }

  for (const key in patchToApply) {
    if (!Object.hasOwn(patchToApply, key)) continue
    const subPatch = patchToApply[key]
    const targetValue = t[key]

    if (
      // 双方都是纯对象才递归(targetValue 非纯对象直接整体覆盖)
      isPlainObject(targetValue) &&
      isPlainObject(subPatch) &&
      Object.hasOwn(t, key) &&
      // patch 里的值不能是响应式对象(避免把响应式对象当普通对象遍历)
      !isRef(subPatch) &&
      !isReactive(subPatch)
    ) {
      t[key] = mergeReactiveObjects(targetValue, subPatch)
      const targetRef: Ref = toRaw(t)[key]
      if (isRef(targetRef) && isShallow(targetRef)) triggerRef(targetRef)
    } else {
      // 新键、非纯对象、响应式值 → 直接覆盖
      t[key] = subPatch
    }
  }

  return target
}