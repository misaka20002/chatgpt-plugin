/**
 * 记忆召回模式的哨兵值。
 *
 * 单独成文件：provider 引用校验（配置层）与锅巴 schema（UI 层）都要识别 `all`，
 * 但两者都不该为此把整条召回链路（recall → store）拉进依赖里。
 */
export const RECALL_MODE_ALL = 'all'
