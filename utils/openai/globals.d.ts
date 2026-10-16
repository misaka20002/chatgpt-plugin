/**
 * 宿主（TRSS-Yunzai）注入的全局对象声明，供本目录 .ts 孪生源码通过类型检查。
 * 这些 .ts 不参与运行；运行链走同名 .js，logger 由宿主 setLog() 注入为全局。
 */
declare const logger: {
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
}
