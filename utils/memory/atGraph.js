// 图谱只消费原文中的结构化 @ 字段；统计、排行和坐标全部在本地计算。
const STYLES = {
  mutual: { color: '#d66c91', label: '双向互动' },
  outgoing: { color: '#9280cd', label: '仅主动 @' },
  incoming: { color: '#53aaa9', label: '仅收到 @' }
}
const MAX_NODES = 18

function label(value, fallback = '') {
  return String(value || fallback).replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, 80)
}

function shortName(value, max = 8) {
  const chars = Array.from(value)
  return chars.length > max ? chars.slice(0, max).join('') + '…' : value
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

/** 只返回绘图需要的聚合数据，不把聊天正文交给模板或任何模型。 */
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
    }
  }

  const partners = [...pairs.values()].map(p => {
    const name = names.get(p.id)?.name || p.id
    const kind = p.outgoing && p.incoming ? 'mutual' : p.outgoing ? 'outgoing' : 'incoming'
    return { ...p, name, shortName: shortName(name), initials: initials(name), kind, ...STYLES[kind], total: p.outgoing + p.incoming }
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
  const displayed = partners.slice(0, MAX_NODES)
  const center = { x: 688, y: 480 }
  const innerCount = Math.min(displayed.length, 6)
  const nodes = displayed.map((p, index) => {
    const inner = index < innerCount
    const count = inner ? innerCount : displayed.length - innerCount
    const slot = inner ? index : index - innerCount
    const angle = -Math.PI / 2 + 2 * Math.PI * slot / count + (inner ? 0 : Math.PI / count)
    const rx = inner ? 255 : 540
    const ry = inner ? 226 : 420
    const x = Math.round(center.x + rx * Math.cos(angle))
    const y = Math.round(center.y + ry * Math.sin(angle))
    const dx = x - center.x
    const dy = y - center.y
    const distance = Math.hypot(dx, dy)
    const start = { x: center.x + dx / distance * 92, y: center.y + dy / distance * 92 }
    const end = { x: x - dx / distance * 48, y: y - dy / distance * 48 }
    const bend = index % 2 === 0 ? 28 : -28
    const cx = (start.x + end.x) / 2 - dy / distance * bend
    const cy = (start.y + end.y) / 2 + dx / distance * bend
    const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
    return { ...p, x, y, path, width: +(1.8 + 4.2 * Math.sqrt(p.total / displayed[0].total)).toFixed(2), rank: index + 1 }
  })
  const name = label(targetName, names.get(target)?.name || target)
  return {
    target: { id: target, name, initials: initials(name) },
    groupName: label(groupName, gid), groupId: gid,
    generatedLabel: dateLabel(generatedAt, true),
    rangeLabel: records ? `${dateLabel(firstTime)} — ${dateLabel(lastTime)}` : '暂无保留记录',
    records, limited, limit, total, outgoing, incoming, partnerCount: partners.length,
    mutualCount: mutual.length,
    mutualPercent: partners.length ? Math.round(mutual.length / partners.length * 100) : 0,
    affectionRank,
    nodes, hiddenCount: partners.length - nodes.length,
    outgoingRank: ranking(partners, 'outgoing'), incomingRank: ranking(partners, 'incoming'),
    mutualRank: mutual.slice(0, 3),
    composition: Object.entries(STYLES).map(([kind, style]) => {
      const count = partners.filter(p => p.kind === kind).length
      return { ...style, kind, count, percent: partners.length ? count / partners.length * 100 : 0 }
    })
  }
}
