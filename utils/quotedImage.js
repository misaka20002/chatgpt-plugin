import sharp from 'sharp'
import { unescapeCqCode } from './cqCode.js'

/** 一次对话最多送进模型的引用图数量；超出部分只记日志，不报错 */
export const QUOTED_IMAGE_LIMIT = 4

/** 引用图进模型的硬上限：超过直接丢弃，连转码都不做 */
export const QUOTED_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** 超过这个体积才转 jpeg 省流量；转码只换编码，不改尺寸 */
const VISION_JPEG_THRESHOLD_BYTES = 2 * 1024 * 1024
/** 重编码统一用 jpeg，质量取 sharp 的常用档 */
const VISION_JPEG_QUALITY = 85
/** 这些格式在阈值内原样送出；其它格式（bmp/avif…）模型侧不一定认，统一转 jpeg */
const VISION_SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif'])

/** 有引用图取不到时追加给模型的当轮提示；只能进 system，写进用户消息会被持久化进对话历史 */
const QUOTED_IMAGE_FAILURE_HINT = '（引用的图片获取失败，请勿臆测图片内容）'

/**
 * 把「引用图失败」提示并入本轮系统指令
 *
 * 不能拼进用户消息：四种客户端都会把 user 消息（含 originalContent）写进会话存储，
 * 失败提示会跟着进入后续轮次，模型会反复以为当前图片仍取不到。
 * 只在确实有图没取到时调用，所以不需要再传一个布尔量。
 *
 * @param {string} system 本轮系统提示
 * @returns {string}
 */
export function appendMediaFailureHint(system) {
  const base = String(system || '')
  return base ? `${base}\n${QUOTED_IMAGE_FAILURE_HINT}` : QUOTED_IMAGE_FAILURE_HINT
}

/**
 * 取本轮 system：缓存里只存基础版本，提示按每次尝试单独追加
 *
 * `prepared.system` 在同一次 sendMessage 内跨主备 provider 复用：把提示写进缓存，
 * 备用 provider 就会带着主 provider 那次的取图失败状态，反之亦然。
 *
 * @param {{system?: string}} prepared 本轮共享的准备态（主备复用同一个对象）
 * @param {string} system 本次尝试构建的基础 system
 * @param {boolean} failed 本次尝试是否有引用图未送入模型
 * @param {{useCache?: boolean}} [options] useCache=false 用于上下文压缩重试：本次重建的 system 必须生效，不能回落到缓存
 * @returns {string}
 */
export function resolveTurnSystem(prepared, system, failed, { useCache = true } = {}) {
  const base = useCache ? (prepared.system ??= system) : system
  return failed ? appendMediaFailureHint(base) : base
}


/**
 * 收集服务端事件里的媒体地址
 *
 * 事件带来的地址由适配器从 QQ 消息段里取出，模型无法指定，按来源可信处理；
 * 统一 unescape 后再比较，避免 CQ 字符串（raw_message）与消息段数组两种写法对不上。
 * 合并转发展开时收集的媒体段地址（`e.forwardMediaUrls`）同属这一层，
 * 但只含 image/video 段真正携带的地址——文本节点里的 URL 不会被登记进来。
 *
 * @param {object} e 云崽事件对象
 * @returns {Set<string>} 已还原 CQ 实体的地址集合
 */
export function collectEventMediaUrls(e) {
  const urls = new Set()
  const push = (value) => {
    if (typeof value !== 'string' || !value) return
    urls.add(unescapeCqCode(value))
  }
  if (Array.isArray(e?.img)) e.img.forEach(push)
  if (Array.isArray(e?.get_Video)) e.get_Video.forEach(item => push(item?.url))
  if (Array.isArray(e?.forwardMediaUrls)) e.forwardMediaUrls.forEach(push)
  return urls
}

/**
 * 判断地址是否就是本次事件里的媒体地址
 *
 * 模型可能在工具参数里回传事件里的 QQ 图地址（例如从群聊上下文的 raw_message 抄来），
 * 这种地址与「模型自己编的地址」风险不同：解析结果由 QQ CDN 决定，模型只能挑选。
 *
 * 合并转发的图片可能带括号或空白，渲染时用 `<url>` 包住 Markdown 目标；
 * 模型原样回传时会把这个尖括号一起带回来，比较前先剥掉一层。
 *
 * @param {object} e 云崽事件对象
 * @param {string} url 待判定地址
 * @returns {boolean}
 */
export function isTrustedEventMediaUrl(e, url) {
  if (typeof url !== 'string' || !url) return false
  return collectEventMediaUrls(e).has(unescapeCqCode(stripWrappingAngle(url)))
}

/** 剥掉 Markdown 目标的一层尖括号（只处理整串被包住的情况） */
function stripWrappingAngle(url) {
  const value = url.trim()
  return value.startsWith('<') && value.endsWith('>') ? value.slice(1, -1).trim() : value
}

/**
 * 把任意图片压成模型可接受的形态
 *
 * 默认保持原始分辨率与画面内容：不缩放、不裁剪。只有三种情况重编码为 jpeg（仍不缩放）：
 * 原始体积超过 2 MB、动图（gif，取首帧）、格式不在 jpeg/png/webp/gif 之内。
 * EXIF 方向会在重编码时应用，避免「图是躺着的」。
 *
 * @param {Buffer} buffer 原始图片字节
 * @returns {Promise<{mimeType: string, data: string}>} 可直接进模型的 base64
 */
export async function normalizeVisionImage(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata()
  if (!meta?.format || !meta?.width || !meta?.height) throw new Error('无法识别图片格式')

  const needsJpeg = meta.format === 'gif'
    || !VISION_SUPPORTED_FORMATS.has(meta.format)
    || buffer.length > VISION_JPEG_THRESHOLD_BYTES
  if (!needsJpeg) {
    return { mimeType: `image/${meta.format}`, data: buffer.toString('base64') }
  }

  const encoded = await sharp(buffer, { failOn: 'none', page: 0 })
    .rotate()
    .jpeg({ quality: VISION_JPEG_QUALITY })
    .toBuffer()
  return { mimeType: 'image/jpeg', data: encoded.toString('base64') }
}

/**
 * 一轮只取一次：同一份 prepared 里复用取图结果
 *
 * 主备 provider 切换会对同一条消息重复走到取图；不缓存的话，4 张图要下载并转码多次。
 * 缓存放 `prepared`（生命周期是一次 sendMessage），所以失败结果也会被复用——
 * 这是刻意的：一轮内重试下载只会放大延迟，换 provider 也不会让坏地址变好。
 *
 * @param {object} e 云崽事件对象
 * @param {{quoted?: {medias: Array<object>, failed: number}}} [prepared] 本轮共享的准备态
 * @returns {Promise<{medias: Array<object>, failed: number}>}
 */
export async function loadQuotedImages(e, prepared) {
  if (prepared?.quoted) return prepared.quoted
  const result = await loadQuotedImageMedias(e)
  if (prepared) prepared.quoted = result
  return result
}

/**
 * 取本次消息引用图并转成模型入参
 *
 * 走 url2Base64 而不是裸 fetch：复用大小上限与 CQ 还原；不传 e，避免失败时向会话回话。
 * 下载开启 enforceAlwaysBlocked：私网/CGNAT 放行但固定连接目标，因此这条路径不走 Config.proxy。
 *
 * @param {object} e 云崽事件对象
 * @returns {Promise<{medias: Array<{mimeType: string, data: string}>, failed: number}>}
 */
export async function loadQuotedImageMedias(e) {
  const urls = (Array.isArray(e?.img) ? e.img : []).filter(url => typeof url === 'string' && url)
  if (!urls.length) return { medias: [], failed: 0 }

  const picked = urls.slice(0, QUOTED_IMAGE_LIMIT)

  // 延迟到调用时加载：paimonFuction 会拉起整条媒体下载与 provider 链路，
  // 而只做来源判定/格式归一化的调用方（含测试）不该被迫加载它
  const { url2Base64 } = await import('./paimonFuction.js')
  const medias = []
  let failed = 0
  for (const url of picked) {
    try {
      // url2Base64 内部吞掉异常并返回 null，真实原因只能从 onError 取回
      let lastError = ''
      const buffer = await url2Base64(url, true, false, {
        // 10 MB 是硬上限：超过的图直接丢弃，不做「先下载再转码」的补偿
        maxSizeBytes: QUOTED_IMAGE_MAX_BYTES,
        // 事件地址允许本地文件（适配器可能给 base64:// 或本地路径）
        allowLocalFile: true,
        // 私网/CGNAT 放行（QQ CDN 会落在这里），但仍固定连接并拦回环/云元数据
        allowPrivateNetwork: true,
        enforceAlwaysBlocked: true,
        onError: (err) => { lastError = err?.message || String(err) }
      })
      if (!buffer) {
        failed++
        logger.warn(`[ChatGPT][引用图] 引用图获取失败: ${lastError || '未知原因'}`)
        continue
      }
      medias.push(await normalizeVisionImage(buffer))
    } catch (err) {
      failed++
      logger.warn(`[ChatGPT][引用图] 引用图处理失败: ${err?.message || err}`)
    }
  }
  // 张数在下载与转码之后才确定：先报「计划送几张」会在全部失败时与事实不符
  logger.info(`[ChatGPT][引用图] 引用图 ${urls.length} 张，上限 ${QUOTED_IMAGE_LIMIT} 张，实际送入 ${medias.length} 张`)
  if (failed) logger.warn(`[ChatGPT][引用图] 引用图 ${failed} 张未送入模型`)
  return { medias, failed }
}
