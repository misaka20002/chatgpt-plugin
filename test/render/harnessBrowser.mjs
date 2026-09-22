// test/render 下各套件共用的浏览器引导。
//
// 为什么需要这一层：部分 Windows 环境（受管终端 / 沙箱）里 node 自己 spawn Chromium 会被静默掐死
// ——子进程退出码 0、stderr 为空，puppeteer 只报 `Failed to launch the browser process: Code: 0`，
// 看不出任何原因；而由 PowerShell `Start-Process` 拉起的 Edge 是活的（`--remote-debugging-port` 可访问）。
// 所以统一支持「优先连接、连不上再 launch」，与生产 `utils/browser.js` 的策略一致。
//
// 用法（连已启动的实例）：
//   PUPPETEER_BROWSER_URL=http://127.0.0.1:9333 node test/render/xxx.check.mjs
// 用法（自己 launch）：
//   PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium node test/render/xxx.check.mjs
import fs from 'node:fs'
import puppeteer from 'puppeteer'

/** 按平台挑浏览器；都找不到就交给 puppeteer 自带 Chrome */
export function resolveBrowserPath () {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH
  if (process.platform === 'win32') {
    const candidates = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ]
    return candidates.find((p) => fs.existsSync(p))
  }
  return undefined
}

/** 打开浏览器：优先连 `PUPPETEER_BROWSER_URL` 指向的实例，否则自己 launch */
export async function openBrowser () {
  const browserURL = process.env.PUPPETEER_BROWSER_URL
  if (browserURL) {
    const browser = await puppeteer.connect({ browserURL, defaultViewport: null })
    browser.__connected = true
    return browser
  }
  return puppeteer.launch({ headless: true, executablePath: resolveBrowserPath() })
}

/** 连接来的实例只能断开、不能关：关了会把用户或其他套件共用的浏览器一起杀掉 */
export async function closeBrowser (browser) {
  if (browser.__connected) browser.disconnect()
  else await browser.close()
}

/** 环境行文案，供各套件在开头打印，避免三处各写一遍 */
export function browserLabel () {
  if (process.env.PUPPETEER_BROWSER_URL) return `连接 ${process.env.PUPPETEER_BROWSER_URL}`
  return resolveBrowserPath() || 'puppeteer 自带 Chrome'
}
