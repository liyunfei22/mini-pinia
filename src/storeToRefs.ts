/**
 * storeToRefs —— 从 store 里提取可解构的引用
 * 对应官方:packages/pinia/src/storeToRefs.ts
 * 教学点:
 * 1. 为什么不能直接解构 store:`const { count } = store` 把解包后的值
 *    「拆成快照」,count 变成普通数字、丢失响应性;
 * 2. storeToRefs 遍历 toRaw(store) 逐键四分类:
 *    - computed(`value?.effect`)→ 包一层带 get/set 的 computed(可解构可写,写回 store);
 *    - ref / reactive → toRef(store, key)(引用 store 本体上的键,保持双向同步);
 *    - 函数(actions)与普通值(非响应式扩展)→ 跳过(官方 R1006 会提醒);
 * 3. 插件加的 ref 也会被收编(它们同样挂在 store 上)。
 */
import { computed, isReactive, isRef, toRaw, toRef } from 'vue'

export function storeToRefs<S extends Record<string, any>>(store: S): Record<string, any> {
  const rawStore = toRaw(store)
  const refs: Record<string, any> = {}
  for (const key in rawStore) {
    const value = rawStore[key]
    // getter(computed):包一层带 get/set 的 computed,解构后可通过 .value 读写(写回 store)
    if (value?.effect) {
      refs[key] = computed({
        get: () => store[key],
        set(value) {
          store[key] = value
        },
      })
    }
    // state(ref / reactive):toRef 引用 store 上的键,解构后与 store 保持同步
    else if (isRef(value) || isReactive(value)) {
      refs[key] = toRef(store, key)
    }
    // 其余(函数、普通值)跳过
  }
  return refs
}