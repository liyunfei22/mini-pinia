/**
 * mapHelpers —— Options-API 辅助(mapState/mapGetters/mapActions/mapWritableState)
 * 对应官方:packages/pinia/src/mapHelpers.ts(4.1:1383-1508)
 * 教学点:
 * 1. 这些 helper 生成的每个函数/计算属性都依赖 `this.$pinia` —— 那正是 install 时
 *    挂到 app.config.globalProperties 的全局属性;组合式 API 走 provide/inject,
 *    Options-API 走 $pinia,是同一条注入链的两端;
 * 2. mapState 有数组(键名直映)与对象(键重映射)两种形态;对象形态的值可以是
 *    函数 —— 以「组件」为 this 调用,实参是 store(可读组件实例做派生);
 * 3. mapWritableState 返回 { get, set } 计算属性描述符,可直接用于 v-model;
 * 简化点(见 docs/06):mapStores / setMapStoreSuffix 未实现(官方 1384-1428)。
 */
import type { StoreDefinition } from './types'

/** 通过组件实例的 this.$pinia 取 store(以 any 桥接动态键访问,骨架类型承诺见 docs/06) */
const storeOf = (useStore: StoreDefinition, ctx: any): any => useStore(ctx.$pinia)

/** mapState:state 与 getters 映射为组件 computed(数组/对象两形态) */
export function mapState(
  useStore: StoreDefinition,
  keysOrMapper: any,
): Record<string, any> {
  return Array.isArray(keysOrMapper)
    ? keysOrMapper.reduce((reduced: any, key: string) => {
        reduced[key] = function (this: any) {
          return storeOf(useStore, this)[key]
        }
        return reduced
      }, {})
    : Object.keys(keysOrMapper).reduce((reduced: any, key: string) => {
        reduced[key] = function (this: any) {
          const store = storeOf(useStore, this)
          const storeKey = keysOrMapper[key]
          // 函数形态:以组件为 this(官方同款),实参为 store
          return typeof storeKey === 'function' ? storeKey.call(this, store) : store[storeKey]
        }
        return reduced
      }, {})
}

/** mapState 的别名(官方标注 deprecated,保留同名行为) */
export const mapGetters = mapState

/** mapActions:actions 映射为组件 methods(参数透传,返回 action 的返回值) */
export function mapActions(
  useStore: StoreDefinition,
  keysOrMapper: any,
): Record<string, any> {
  return Array.isArray(keysOrMapper)
    ? keysOrMapper.reduce((reduced: any, key: string) => {
        reduced[key] = function (this: any, ...args: any[]) {
          return storeOf(useStore, this)[key](...args)
        }
        return reduced
      }, {})
    : Object.keys(keysOrMapper).reduce((reduced: any, key: string) => {
        reduced[key] = function (this: any, ...args: any[]) {
          return storeOf(useStore, this)[keysOrMapper[key]](...args)
        }
        return reduced
      }, {})
}

/** mapWritableState:state 映射为可写计算属性描述符(可用于 v-model) */
export function mapWritableState(
  useStore: StoreDefinition,
  keysOrMapper: any,
): Record<string, any> {
  const createDescriptor = (from: string) => ({
    get(this: any) {
      return storeOf(useStore, this)[from]
    },
    set(this: any, value: any) {
      return (storeOf(useStore, this)[from] = value)
    },
  })
  return Array.isArray(keysOrMapper)
    ? keysOrMapper.reduce((reduced: any, key: string) => {
        reduced[key] = createDescriptor(key)
        return reduced
      }, {})
    : Object.keys(keysOrMapper).reduce((reduced: any, key: string) => {
        reduced[key] = createDescriptor(keysOrMapper[key])
        return reduced
      }, {})
}