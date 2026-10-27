import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { fetchVerified, pullPatch, sha256, MIRRORS } from '../utils/commandMap/fetchMap.js'
import { syncPatches } from '../utils/commandMap/sync.js'

/**
 * 镜像链（次缝：注入假 fetch）。
 *
 * 不联网。要钉住的是三条真实事故：镜像返回 200 却是自家首页、中转站改写内容、
 * 以及「全链都挂时不能把半份数据当成功」。
 */

const URL = 'https://raw.githubusercontent.com/owner/repo/main/maps/a.json'
const MAP = JSON.stringify({ schema: 1, plugin: { key: 'delta', fingerprint: 'f1' }, commands: { '#a': { keys: ['甲'], risk: 'q' } } })
const GOOD = sha256(MAP)

function response (text, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => text }
}

function fakeFetch (script) {
  let index = 0
  const calls = []
  const impl = async url => {
    calls.push(url)
    const step = script[Math.min(index, script.length - 1)]
    index += 1
    if (step instanceof Error) throw step
    return step
  }
  impl.calls = calls
  return impl
}

describe('镜像链', () => {
  test('第一个源就命中时不碰后面的源', async () => {
    const fetchImpl = fakeFetch([response(MAP)])
    const result = await fetchVerified(URL, { sha256: GOOD, fetchImpl })

    assert.equal(result.source, 'direct')
    assert.equal(fetchImpl.calls.length, 1)
  })

  test('直连失败自动换下一个源', async () => {
    const fetchImpl = fakeFetch([new Error('ECONNRESET'), response(MAP)])
    const result = await fetchVerified(URL, { sha256: GOOD, fetchImpl })

    assert.equal(result.source, 'gh-proxy.at9.net')
    assert.equal(fetchImpl.calls.length, 2)
  })

  test('返回 200 但不是地图（哈希不符）时继续换源，不把它当成功', async () => {
    const fetchImpl = fakeFetch([response('<html>镜像首页</html>'), response(MAP)])
    const result = await fetchVerified(URL, { sha256: GOOD, fetchImpl })

    assert.equal(result.source, 'gh-proxy.at9.net')
    assert.equal(fetchImpl.calls.length, 2)
  })

  test('全链都失败时抛出，并列出每个源的原因', async () => {
    const fetchImpl = fakeFetch([new Error('timeout'), response('not json'), response('')])
    await assert.rejects(
      () => fetchVerified(URL, { sha256: GOOD, fetchImpl }),
      /地图下载失败.*direct/
    )
  })

  test('jsDelivr 只接受 raw 形状的地址，其余跳过', async () => {
    const fetchImpl = fakeFetch([response(MAP)])
    await fetchVerified('https://example.com/a.json', { fetchImpl, sha256: GOOD })
    // example.com 只有直连能构造出来，其余三个前缀加 jsDelivr 都被跳过
    assert.equal(fetchImpl.calls.length, 1)
  })
})

describe('拉取补丁', () => {
  const target = { pluginKey: 'delta', fingerprint: 'f1', url: URL, sha256: GOOD }

  test('缓存命中时完全不联网', async () => {
    const fetchImpl = fakeFetch([response(MAP)])
    const result = await pullPatch(target, {
      fetchImpl,
      readCache: () => ({ key: 'delta', fingerprint: 'f1', commands: new Map() })
    })

    assert.equal(result.source, 'cache')
    assert.equal(fetchImpl.calls.length, 0)
  })

  test('下载成功才落盘，且落的是原始 JSON', async () => {
    const saved = []
    const result = await pullPatch(target, {
      fetchImpl: fakeFetch([response(MAP)]),
      readCache: () => null,
      save: patch => saved.push(patch)
    })

    assert.equal(result.source, 'direct')
    assert.equal(saved.length, 1)
    assert.equal(saved[0].key, 'delta')
    assert.equal(saved[0].commands.size, 1)
  })

  test('内容不是合法地图时不落盘', async () => {
    const saved = []
    await assert.rejects(
      // 哈希对得上、但内容不是合法地图：走「形状校验」这条路径
      () => pullPatch({ pluginKey: 'delta', fingerprint: 'f2', url: URL, sha256: sha256('{"schema":1}') }, {
        fetchImpl: fakeFetch([response('{"schema":1}')]),
        readCache: () => null,
        save: patch => saved.push(patch)
      }),
      /形状不合法/
    )
    assert.equal(saved.length, 0)
  })

  test('没有哈希声明时拒绝下载（宁可不装，也不装来路不明的）', async () => {
    await assert.rejects(
      () => pullPatch({ pluginKey: 'delta', fingerprint: 'f3', url: URL }, { readCache: () => null }),
      /缺少 sha256/
    )
  })

  test('镜像链顺序与实测记录一致', () => {
    assert.deepEqual(MIRRORS.map(item => item.name), [
      'direct',
      'gh-proxy.at9.net',
      'gh.xmly.dev',
      'cors.isteed.cc',
      'jsDelivr'
    ])
  })
})


describe('地图同步', () => {
  const INDEX = JSON.stringify({
    schema: 1,
    plugins: {
      delta: { file: 'maps/delta.json', fingerprint: 'f1', sha256: 'aa' },
      yenai: { file: 'maps/yenai.json', fingerprint: 'f2', sha256: 'bb' }
    }
  })
  const INDEX_URL = 'https://raw.githubusercontent.com/owner/repo/main/index.json'

  test('只拉本机装了的插件，其余计入 skipped', async () => {
    const pulled = []
    const result = await syncPatches({
      indexUrl: INDEX_URL,
      pluginKeys: ['delta'],
      fetchImpl: fakeFetch([response(INDEX)]),
      pull: async target => {
        pulled.push(target)
        return { patch: { key: target.pluginKey }, source: 'direct' }
      }
    })

    assert.equal(result.updated, 1)
    assert.equal(result.skipped, 1)
    assert.equal(result.failed, 0)
    assert.equal(pulled.length, 1)
    // 相对路径要拼到索引所在目录上
    assert.equal(pulled[0].url, 'https://raw.githubusercontent.com/owner/repo/main/maps/delta.json')
  })

  test('单份失败不影响其余，失败原因带插件名', async () => {
    const result = await syncPatches({
      indexUrl: INDEX_URL,
      pluginKeys: ['delta', 'yenai'],
      fetchImpl: fakeFetch([response(INDEX)]),
      pull: async target => {
        if (target.pluginKey === 'delta') throw new Error('哈希不符')
        return { patch: {}, source: 'cache' }
      }
    })

    assert.equal(result.updated, 1)
    assert.equal(result.failed, 1)
    assert.match(result.errors[0], /delta: 哈希不符/)
  })

  test('索引结构不合法时整体失败', async () => {
    await assert.rejects(
      () => syncPatches({ indexUrl: INDEX_URL, pluginKeys: ['delta'], fetchImpl: fakeFetch([response('{"plugins":1}')]) }),
      /索引结构不合法/
    )
  })
})
