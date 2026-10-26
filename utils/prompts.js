import fs from 'fs'
import { mkdirs } from './common.js'
export function readPrompts () {
  const _path = process.cwd()
  let prompts = []
  if (fs.existsSync(`${_path}/plugins/chatgpt-plugin/prompts`)) {
    if (fs.existsSync(`${_path}/plugins/chatgpt-plugin/prompts`)) {
      const files = fs.readdirSync(`${_path}/plugins/chatgpt-plugin/prompts`)
      const txtFiles = files.filter(file => file.endsWith('.txt'))
      txtFiles.forEach(txtFile => {
        // 只去掉 .txt 后缀本身：lodash 的 trimEnd 把第二参当字符集合，
        // 会连名字结尾的 t/x/. 一起削掉（cat.txt 变成 ca），菜单里就显示错名字。
        const name = txtFile.replace(/\.txt$/i, '')
        const content = fs.readFileSync(`${_path}/plugins/chatgpt-plugin/prompts/${txtFile}`, 'utf8')
        let example = []
        try {
          if (fs.existsSync(`${_path}/plugins/chatgpt-plugin/prompts/${name}_example.json`)) {
            example = fs.readFileSync(`${_path}/plugins/chatgpt-plugin/prompts/${name}_example.json`, 'utf8')
            example = JSON.parse(example)
          }
        } catch (err) {
          logger.info(err)
        }
        prompts.push({
          name,
          content,
          example
        })
      })
    }
  }
  // readdirSync 的顺序由文件系统决定，菜单序号需要每次一致，所以按名字排一次。
  prompts.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return prompts
}

export function getPromptByName (name) {
  if (!name) {
    return null
  }
  let prompts = readPrompts()
  let hits = prompts.filter(p => p.name.trim() === name.trim())
  if (hits && hits.length > 0) {
    return hits[0]
  } else {
    return null
  }
}

export function saveOnePrompt (name, content, examples) {
  const _path = process.cwd()
  mkdirs(`${_path}/plugins/chatgpt-plugin/prompts`)
  let filePath = `${_path}/plugins/chatgpt-plugin/prompts/${name}.txt`
  fs.writeFileSync(filePath, content)
  if (examples) {
    let examplePath = `${_path}/plugins/chatgpt-plugin/prompts/${name}_example.json`
    fs.writeFileSync(examplePath, JSON.stringify(examples))
  }
}

export function deleteOnePrompt (name) {
  const _path = process.cwd()
  mkdirs(`${_path}/plugins/chatgpt-plugin/prompts`)
  let filePath = `${_path}/plugins/chatgpt-plugin/prompts/${name}.txt`
  fs.unlinkSync(filePath)
  try {
    let examplePath = `${_path}/plugins/chatgpt-plugin/prompts/${name}_example.json`
    fs.unlinkSync(examplePath)
  } catch (err) {}
}
