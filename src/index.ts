/**
 * index —— mini-pinia 公共 API 出口
 * 对应官方:packages/pinia/src/index.ts
 * 约定:导出面与官方保持一致 —— 读者对照官方源码时按图索骥。
 * 演进:rootStore 相关 M1 落地;createPinia/defineStore M2;storeToRefs/mapXxx M4。
 * 官方 4.1 导出但我们刻意省略的:acceptHMRUpdate、mapStores、setMapStoreSuffix、
 * shouldHydrate、skipHydrate(全部记入 docs/06 对照表)。
 */
export { setActivePinia, getActivePinia, getStores, piniaSymbol } from './rootStore'
export { MutationType } from './types'
export type * from './types'