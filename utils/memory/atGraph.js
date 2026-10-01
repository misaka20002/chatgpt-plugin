// 图谱按结构化 @ 字段统计，附最近一次收到 @ 的消息节选；全部在本地计算。
const STYLES = {
  mutual: { color: '#8965cc', label: '双向互动' },
  outgoing: { color: '#438dcc', label: '仅主动 @' },
  incoming: { color: '#269f91', label: '仅收到 @' }
}
const MAX_NODES = 18

function label(value, fallback = '') {
  return Array.from(String(value || fallback).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim()).slice(0, 80).join('')
}

function initials(value) {
  return Array.from(value.replace(/\s/g, '')).slice(0, 2).join('') || '@'
}

function dateLabel(seconds, withTime = false) {
  const iso = new Date(seconds * 1000 + 8 * 3600 * 1000).toISOString()
  return iso.slice(0, withTime ? 16 : 10).replace('T', ' ')
}

function byTotal(a, b) {
  return b.total - a.total || a.id.localeCompare(b.id, 'en')
}

function ranking(partners, key) {
  const sorted = partners.filter(p => p[key] > 0).sort((a, b) => b[key] - a[key] || byTotal(a, b)).slice(0, 5)
  return sorted.map((p, index) => ({ ...p, rank: index + 1, count: p[key], bar: Math.max(2, p[key] / sorted[0][key] * 100) }))
}

function graphLayout(people) {
  const width = 1376
  const nodeShape = (size, ux, uy, person) => {
    const pill = (count, side) => {
      const width = Math.max(40, 20 + String(count).length * 10)
      // 水平胶囊沿径向贴在头像边缘，保留少量压边；数字始终正向，便于阅读。
      const projection = Math.abs(ux) * width / 2 + Math.abs(uy) * 14
      const offset = size / 2 + projection - 6
      return { x: side * ux * offset, y: side * uy * offset, width, projection, offset }
    }
    const pills = { sent: pill(person.outgoing, -1), received: pill(person.incoming, 1) }
    const both = Object.values(pills)
    const nameGap = Math.max(size / 2, ...both.map(p => p.y + 14)) - size / 2 + 12
    // 完整昵称放在头像和胶囊的下方；避碰同时包含两侧胶囊，不能只量头像。
    const bounds = {
      left: Math.min(-114, ...both.map(p => p.x - p.width / 2 - 8)),
      right: Math.max(114, ...both.map(p => p.x + p.width / 2 + 8)),
      top: Math.min(-size / 2 - 8, ...both.map(p => p.y - 22)),
      bottom: size / 2 + nameGap + 86
    }
    return { pills, nameGap, bounds }
  }
  const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  for (let height = people.length > 10 ? 1360 : 1120; height <= 1920; height += 200) {
    const center = { x: width / 2, y: height / 2 - 40 }
    const occupied = [{ left: center.x - 150, right: center.x + 150, top: center.y - 102, bottom: center.y + 192 }]
    const nodes = []
    let previousRadius = 0
    for (let index = 0; index < people.length; index++) {
      const person = people[index]
      const desired = 250 + 180 * (1 - Math.log1p(person.total) / Math.log1p(people[0].total))
      const minimum = Math.max(desired, previousRadius + (index && person.total < people[index - 1].total ? 3 : 0))
      let position
      for (let radius = minimum; radius < Math.hypot(width / 2, height / 2) && !position; radius += 8) {
        // 按最终布局距离缩小头像，避碰和连线共用同一尺寸，昵称仍保留完整排版空间。
        const avatarSize = +Math.max(60, Math.min(112, 112 * (250 / radius) ** 0.75)).toFixed(2)
        let best
        for (let step = 0; step < 180; step++) {
          const angle = -Math.PI / 2 + step * Math.PI / 90
          const ux = Math.cos(angle), uy = Math.sin(angle)
          const x = center.x + radius * ux
          const y = center.y + radius * uy
          const shape = nodeShape(avatarSize, ux, uy, person)
          const bounds = { left: x + shape.bounds.left, right: x + shape.bounds.right, top: y + shape.bounds.top, bottom: y + shape.bounds.bottom }
          if (bounds.left < 20 || bounds.right > width - 20 || bounds.top < 20 || bounds.bottom > height - 20) continue
          if (occupied.some(other => overlap(bounds, other))) continue
          const separation = nodes.length ? Math.min(...nodes.map(n => Math.hypot(n.x - x, n.y - y))) : -step
          if (!best || separation > best.separation) best = { x, y, radius, avatarSize, pills: shape.pills, nameGap: shape.nameGap, bounds, separation }
        }
        position = best
      }
      if (!position) break
      previousRadius = position.radius
      occupied.push(position.bounds)
      const dx = position.x - center.x
      const dy = position.y - center.y
      const distance = position.radius
      const start = { x: center.x + dx / distance * 104, y: center.y + dy / distance * 104 }
      const endOffset = position.pills.sent.offset + position.pills.sent.projection + 7
      const end = { x: position.x - dx / distance * endOffset, y: position.y - dy / distance * endOffset }
      const bend = index % 2 ? -22 : 22
      const cx = (start.x + end.x) / 2 - dy / distance * bend
      const cy = (start.y + end.y) / 2 + dx / distance * bend
      nodes.push({ ...person, x: position.x, y: position.y, radius: distance, avatarSize: position.avatarSize, pills: position.pills, nameGap: position.nameGap,
        path: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
        width: +(1.8 + 4.2 * Math.sqrt(person.total / people[0].total)).toFixed(2) })
    }
    if (nodes.length === people.length) return { nodes, width, height, center }
  }
  throw new Error('AT图谱布局空间不足，无法避免成员重叠')
}

/** 只返回绘图数据和最近一条收到 @ 的消息节选，不向模型发送聊天内容。 */
export function buildAtGraph({ rows, groupId, targetId, botId = '', targetName = '', groupName = '', generatedAt = Math.floor(Date.now() / 1000), limited = false, limit = 20000 }) {
  const gid = String(groupId)
  const target = String(targetId)
  const bot = String(botId)
  const names = new Map()
  const pairs = new Map()
  const seen = new Set()
  let firstTime = Infinity
  let lastTime = 0
  let records = 0
  let latestMentionRow

  for (const row of rows) {
    if (!row || String(row.groupId) !== gid) continue
    const time = Number(row.time)
    if (!Number.isFinite(time) || time <= 0 || time > generatedAt) continue
    // 同一条消息补录后不能重复计数；没有 ID 的旧数据仍按独立记录处理。
    if (row.messageId != null) {
      const id = String(row.messageId)
      if (seen.has(id)) continue
      seen.add(id)
    }
    records++
    firstTime = Math.min(firstTime, time)
    lastTime = Math.max(lastTime, time)
    const sender = String(row.senderId || '')
    if (row.senderName && (!names.has(sender) || time > names.get(sender).time)) {
      names.set(sender, { name: label(row.senderName, sender), time })
    }
    if (!sender || sender === bot || row.isCommand || !Array.isArray(row.at)) continue
    for (const receiver of new Set(row.at.filter(id => typeof id === 'string' || typeof id === 'number').map(String))) {
      if (!receiver || receiver === 'all' || receiver === bot || receiver === sender) continue
      if (sender !== target && receiver !== target) continue
      const id = sender === target ? receiver : sender
      if (!pairs.has(id)) pairs.set(id, { id, outgoing: 0, incoming: 0 })
      pairs.get(id)[sender === target ? 'outgoing' : 'incoming']++
      // 复用统计过滤条件；同秒消息沿用存储层的倒序顺序，保留先读到的一条。
      if (receiver === target && (!latestMentionRow || time > Number(latestMentionRow.time))) latestMentionRow = row
    }
  }

  const partners = [...pairs.values()].map(p => {
    const name = names.get(p.id)?.name || p.id
    const kind = p.outgoing && p.incoming ? 'mutual' : p.outgoing ? 'outgoing' : 'incoming'
    return { ...p, name, initials: initials(name), kind, ...STYLES[kind], total: p.outgoing + p.incoming }
  }).sort(byTotal)
  const outgoing = partners.reduce((sum, p) => sum + p.outgoing, 0)
  const incoming = partners.reduce((sum, p) => sum + p.incoming, 0)
  const mutual = partners.filter(p => p.kind === 'mutual')
  const total = outgoing + incoming
  // 主动频次逐渐趋于饱和，双向均衡补分；纯收到 @ 不解释成主体的主动好感。
  // 这是可复算的娱乐指数，不从聊天内容推断真实感情。
  const affectionRank = partners.map(p => ({
    ...p,
    score: Math.round(70 * (1 - Math.exp(-p.outgoing / 20)) + 30 * (2 * Math.min(p.outgoing, p.incoming) / p.total))
  })).sort((a, b) => b.score - a.score || byTotal(a, b)).slice(0, 5).map((p, index) => ({ ...p, rank: index + 1 }))
  const layout = graphLayout(partners.slice(0, MAX_NODES))
  const nodes = layout.nodes
  const name = label(targetName, names.get(target)?.name || target)
  let latestMention = null
  if (latestMentionRow) {
    const id = String(latestMentionRow.senderId)
    const senderName = label(latestMentionRow.senderName, names.get(id)?.name || id)
    const text = typeof latestMentionRow.text === 'string'
      ? latestMentionRow.text.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
      : ''
    // 同时限制字数和换行，避免单条长消息或空行撑高整张图；模板仍按纯文本转义。
    const excerpt = Array.from(text).slice(0, 400).join('').split('\n').slice(0, 6).join('\n')
    latestMention = { id, name: senderName, initials: initials(senderName), text: excerpt,
      timeLabel: dateLabel(Number(latestMentionRow.time), true), truncated: excerpt.length < text.length }
  }
  return {
    target: { id: target, name, initials: initials(name) },
    groupName: label(groupName, gid), groupId: gid,
    generatedLabel: dateLabel(generatedAt, true),
    rangeLabel: records ? `${dateLabel(firstTime)} — ${dateLabel(lastTime)}` : '暂无保留记录',
    records, limited, limit, total, outgoing, incoming, partnerCount: partners.length,
    mutualCount: mutual.length,
    mutualPercent: partners.length ? Math.round(mutual.length / partners.length * 100) : 0,
    affectionRank, latestMention,
    nodes, layout: { width: layout.width, height: layout.height, center: layout.center }, hiddenCount: partners.length - nodes.length,
    outgoingRank: ranking(partners, 'outgoing'), incomingRank: ranking(partners, 'incoming'),
    mutualRank: mutual.slice(0, 3),
    composition: Object.entries(STYLES).map(([kind, style]) => {
      const count = partners.filter(p => p.kind === kind).length
      return { ...style, kind, count, percent: partners.length ? count / partners.length * 100 : 0 }
    })
  }
}
