import { AbstractTool } from './AbstractTool.js'
// import { Config } from '../config.js'

export class Sf_image_edit extends AbstractTool {
  name = 'sf_image_edit'

  parameters = {
    properties: {
      prompt: {
        type: 'string',
        description: "The editing instructions or description for modifying the image. Describe what changes you want to make to the existing image, such as style changes, object additions/removals, or other modifications. This is used for image-to-image editing tasks."
      }
    },
    required: []
  }

  description = 'Use this tool ONLY when you need to EDIT or MODIFY an EXISTING image that user has provided. This includes: changing style, adding/removing objects, adjusting colors, or any modifications to an existing picture. DO NOT use this tool for creating new images from scratch.'

  func = async function (opts, e) {
    let { prompt } = opts
    if (e.at === e.bot.uin) {
      e.at = null
    }
    e.atBot = false

    let sf
    try {
      let { SF_Painting } = await import('../../../siliconflow-plugin/apps/SF_Painting.js')
      sf = new SF_Painting(e)
    } catch (err) {
      return 'the user didn\'t install siliconflow-plugin. suggest him to install'
    }
    try {
      e.msg = `#g谷歌编辑图片 ` + prompt;
      await sf.gg_select_and_chat(e)
      console.log('[ChatGPT][sf_image_edit]开始调用sf插件-#g谷歌编辑图片：\nmsg: ', e.msg)
      return 'draw success, picture has been sent.'
    } catch (err) {
      return 'draw failed due to unknown error'
    }

  }
}
