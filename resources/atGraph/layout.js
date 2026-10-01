// 字体度量必须等实际字体加载后再做，不能用字符数猜测 emoji / 中英文混排的宽度。
async function fitNames() {
  await document.fonts.ready
  await Promise.all([...document.images].map(async img => {
    try {
      await img.decode()
    } catch (error) {
      console.warn('AT图谱图片解码失败，保留文字内容：', error.message)
      img.hidden = true
    }
  }))
  for (const element of document.querySelectorAll('[data-fit]')) {
    const maximum = Number(element.dataset.fit)
    for (let size = maximum; size >= 10; size -= 0.5) {
      element.style.fontSize = `${size}px`
      if (element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1) break
    }
  }
  document.documentElement.dataset.atGraphReady = 'true'
}

fitNames().catch(error => console.error('AT图谱昵称排版失败：', error))
