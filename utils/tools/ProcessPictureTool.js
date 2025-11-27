import { AbstractTool } from './AbstractTool.js'
import fetch, { File, FormData } from 'node-fetch'
import { Config } from '../config.js'

/** 图像预处理工具: Image2Hed: 提取图片的边缘轮廓线,类似于素描的线稿, Image2Scribble: 将图片转换为简笔画/涂鸦风格,就像手绘草图 */
export class ProcessPictureTool extends AbstractTool {
  name = 'processPicture'

  parameters = {
    properties: {
      type: {
        type: 'string',
        enum: ['Image2Hed', 'Image2Scribble'],
        description: 'how to process it. Image2Hed: useful when you want to detect the soft hed boundary of the picture; Image2Scribble: useful when you want to generate a scribble of the picture'
      },
      qq: {
        type: 'string',
        description: 'if the picture is avatar of a user, input his qq number'
      },
      url: {
        type: 'string',
        description: 'url of the picture'
      }
    },
    required: ['type']
  }

  description = 'Process images by converting them to edge detection (hed boundary) or scribble format. Supports processing images from URLs or user QQ avatars. Returns a processed image URL that can be sent using SendPictureTool.'

  func = async function (opts, e) {
    let { url, qq, type } = opts
    if (qq) {
      url = `https://q1.qlogo.cn/g?b=qq&s=160&nk=${qq}`
    }
    if (!url) {
      return 'you must give at least one parameter of url and qq'
    }
    const imageResponse = await fetch(url)
    const blob = await imageResponse.blob()
    const arrayBuffer = await blob.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    // await fs.writeFileSync(`data/chatgpt/${crypto.randomUUID()}`, buffer)
    let formData = new FormData()
    formData.append('file', new File([buffer], 'file.png', { type: 'image/png' }))
    let endpoint = 'image2hed'
    switch (type) {
      case 'Image2Scribble': {
        endpoint = 'image2Scribble'
        break
      }
      case 'Image2Hed': {
        endpoint = 'image2hed'
        break
      }
    }
    let captionRes = await fetch(`${Config.extraUrl}/${endpoint}`, {
      method: 'POST',
      body: formData
    })
    if (captionRes.status === 200) {
      let result = await captionRes.text()
      return `the processed image url is ${Config.extraUrl}${result}${qq ? ' and ' + url : ''}. you should send it with SendPictureTool.`
    } else {
      return 'error happened'
    }
  }
}
