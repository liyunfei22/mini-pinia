/**
 * index —— mini-pinia 公共 API 出口
 * 对应官方:packages/pinia/src/index.ts
 * 约定:导出面与官方保持一致 —— 读者对照官方源码时按图索骥。
 * 官方 4.1 导出但我们刻意省略:acceptHMRUpdate、mapStores、setMapStoreSuffix、
 * shouldHydrate、skipHydrate(全部记入 docs/06 对照表)。
 */
export { createPinia, disposePinia } from './createPinia'
export { defineStore } from './store'
export { storeToRefs } from './storeToRefs'
export { mapState, mapGetters, mapActions, mapWritableState } from './mapHelpers'
export { setActivePinia, getActivePinia, getStores, piniaSymbol } from './rootStore'
export { MutationType } from './types'
export type * from './types'