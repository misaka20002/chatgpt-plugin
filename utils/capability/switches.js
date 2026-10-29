/**
 * 指令地图两个开关的判定只写一处。
 *
 * 配置对象由调用方传进来、本文件不 import `Config`：那样会把 lodash 整条依赖拖进任何想测这两个
 * 函数的测试里，于是「默认开还是默认关」这类最该被钉住的判定反而测不了。
 *
 * 口径：地图开关管整套能力（不再拉地图，也不再让 AI 查；缓存留着，重新打开即恢复）；
 * 代执行是叠在它上面的第二道闸，默认关——它执行的是真指令。
 */

/** 指令地图总开关，默认开：只有显式关掉才停 */
export function syncEnabled(config) {
  return config?.enableCommandMapSync !== false
}

/** 代执行，默认关：必须主人显式打开 */
export function delegateEnabled(config) {
  return config?.enableCommandMapDelegate === true
}
