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

    // 为角色添加作品名
    const charactersList = JSON.parse(Config.nai3PluginCharactersList)
    let charactersName = ""
    for (const key of Object.keys(charactersList)) {
      const reg_characters = new RegExp(key, "im")
      charactersName = jsonTags.match(reg_characters) ? charactersList[key] + ", " + charactersName : charactersName
    }

    // 使用nai插件
    if (Config.drawToolS === 'nai-plugin-1' || Config.drawToolS === 'paimonnai-plugin') {
      let nai
      try {
        let { txt2img } = await import('../../../nai-plugin/apps/Txt2img.js')
        nai = new txt2img();
      } catch (err) {
        try {
          let { txt2img } = await import('../../../paimonnai-plugin/apps/Txt2img.js')
          nai = new txt2img();
        } catch (err) {
          return 'the user didn\'t install nai-plugin. suggest him to install'
        }
      }
      try {
        // 随机使用宽图或竖图
        let strPaint = ''
        const random_nai = Math.random();
        if (random_nai < 0.3) {
          strPaint = '宽图'
        }
        else if (random_nai < 0.6) {
          strPaint = '方图'
        }
        e.msg = `#绘画${strPaint}${charactersName}` + Config.nai3PluginToPaintPrefix + ', ' + prompt + ', best quality, amazing quality, very aesthetic, absurdres'
        if (e.img)
          e.msg += ', Reference_Strength = 0.30';
        // 随机 smea
        const random_1 = Math.random()
        e.msg += random_1 < 0.50 ? '' : (random_1 < 0.75 ? ', smea, dynoff' : ', smea');
        console.log('[ChatGPT][DrawTool]开始调用nai插件绘画：\nmsg: ', e.msg)
        await nai.txt2img(e)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    else if (Config.drawToolS === 'nai-plugin-4') {
      // 使用nai插件
      let nai
      try {
        let { Text } = await import('../../../nai-plugin/apps/Text.js')
        nai = new Text();
      } catch (err) {
        return 'the user didn\'t install nai-plugin. suggest him to install'
      }
      try {
        // 随机使用宽图或竖图
        let strPaint = ''
        const random_nai = Math.random();
        if (random_nai < 0.3) {
          strPaint = '--width 1216 --height 832'
        }
        else if (random_nai < 0.6) {
          strPaint = '--width 1024 --height 1024'
        }
        e.msg = `#draw${strPaint}${charactersName}` + Config.nai3PluginToPaintPrefix + ', ' + jsonTags + ', best quality, amazing quality, very aesthetic, absurdres'
        if (e.img)
          e.msg += ', --reference_strength 0.3';
        // 随机 smea
        const random_1 = Math.random()
        e.msg += random_1 < 0.50 ? '' : (random_1 < 0.75 ? ', --sm true --sm_dyn false' : ', --sm true --sm_dyn true');
        console.log('[ChatGPT][DrawTool]开始调用nai插件绘画：\nmsg: ', e.msg)
        await nai.text(e)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    // 使用ap插件
    else if (Config.drawToolS === 'ap-plugin') {
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
        console.log('[ChatGPT][DrawTool]开始调用ap插件绘画：\nmsg: ', e.msg)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    // 使用SF插件sf
    else if (Config.drawToolS === 'siliconflow-plugin-sf') {
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
        console.log('[ChatGPT][DrawTool]开始调用sf插件绘画：\nmsg: ', e.msg)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    // 使用SF插件mj
    else if (Config.drawToolS === 'siliconflow-plugin-mj') {
      let sfmj
      try {
        let { MJ_Painting } = await import('../../../siliconflow-plugin/apps/MJ_Painting.js')
        sfmj = new MJ_Painting(e)
      } catch (err) {
        return 'the user didn\'t install siliconflow-plugin. suggest him to install'
      }
      try {
        e.msg = '#mjp' + prompt
        await sfmj.mj_draw(e)
        console.log('[ChatGPT][DrawTool]开始调用sf插件绘画：\nmsg: ', e.msg)
        return 'draw success, picture has been sent.'
      } catch (err) {
        return 'draw failed due to unknown error'
      }
    }

    else {
      return 'the user didn\'t install any draw plugin. suggest him to install'
    }
  }
}
