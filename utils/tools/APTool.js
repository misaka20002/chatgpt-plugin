import { AbstractTool } from './AbstractTool.js'
import { Config } from '../../utils/config.js'

export class APTool extends AbstractTool {
  name = 'draw'

  parameters = {
    properties: {
      prompt: {
        type: 'string',
        description: 'draw prompt of StableDiffusion, prefer to be in English. should be many keywords split by comma.'
      }
    },
    required: []
  }

  description = 'Useful when you want to draw picture'

  func = async function (opts, e) {
    let { prompt } = opts
    if (e.at === e.bot.uin) {
      e.at = null
    }
    e.atBot = false
    // 使用nai插件
    if (Config.switchToNai3PluginToPaint) {
      let nai
      try {
        // eslint-disable-next-line camelcase
        let { txt2img } = await import('../../../nai-plugin/apps/Txt2img.js')
        nai = new txt2img()
      } catch (err) {
        return 'the user didn\'t install nai-plugin. suggest him to install'
      }
      try {
        e.msg = '#绘画artist:ciloranko, [artist:tianliang duohe fangdongye], [artist:sho_(sho_lwlw)], [artist:baku-p], [artist:tsubasa_tsubasa], ' + prompt + 'best quality, amazing quality, very aesthetic, absurdres'
        await nai.txt2img(e)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    // 使用ap插件
    else if (Config.bingAPDraw) {
      let ap
      try {
        // eslint-disable-next-line camelcase
        let { Ai_Painting } = await import('../../../ap-plugin/apps/aiPainting.js')
        ap = new Ai_Painting(e)
      } catch (err) {
        try {
          // ap的dev分支改名了
          // eslint-disable-next-line camelcase
          let { Ai_Painting } = await import('../../../ap-plugin/apps/ai_painting.js')
          ap = new Ai_Painting(e)
        } catch (err1) {
          return 'the user didn\'t install ap-plugin. suggest him to install'
        }
      }
      try {
        e.msg = '#绘图' + prompt
        await ap.aiPainting(e)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    // 使用SF插件
    else if (Config.bingSFDraw) {
      let sf
      try {
        let { SF_Painting } = await import('../../../siliconflow-plugin/apps/SF_Painting.js')
        sf = new SF_Painting(e)
      } catch (err) {
        return 'the user didn\'t install siliconflow-plugin. suggest him to install'
      }
      try {
        e.msg = '#sf绘图' + prompt
        await sf.sf_draw(e)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }
  }
}
