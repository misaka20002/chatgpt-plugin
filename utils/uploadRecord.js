// 音频原样交给适配器，由平台负责转码和上传。
export default async function uploadRecord(recordUrl) {
  return segment.record(recordUrl)
}
