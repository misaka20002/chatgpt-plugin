import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

export class GithubAPITool extends AbstractTool {
  name = 'github'

  parameters = {
    properties: {
      q: {
        type: 'string',
        description: 'search keyword. you should build it. If you want to find from specified repo, please must use repo:ORG/REPO as part of the keyword. For example, if you want to find the oldest unresolved Python bugs on Windows. Your query might look something like this: q=windows+label:bug+language:python+state:open&sort=created&order=asc'
      },
      type: {
        type: 'string',
        enum: ['repositories', 'issues', 'users', 'code', 'custom'],
        description: 'search type. If custom is chosen, you must provide full github api url path.'
      },
      num: {
        type: 'number',
        description: 'search results limit number, default is 5'
      },
      fullUrl: {
        type: 'string',
        description: 'if type is custom, you need provide this, such as /repos/OWNER/REPO/actions/artifacts?name=NAME&page=2&per_page=1. if type is not custom, is will be ignored'
      }
    },
    required: ['q', 'type']
  }

  func = async function (opts) {
    let { q, type, num = 5, fullUrl = '' } = opts
    let headers = {
      'X-From-Library': 'ikechan8370',
      Accept: 'application/vnd.github+json'
    }
    if (Config.githubAPIKey) {
      headers.Authorization = `Bearer ${Config.githubAPIKey}`
    }
    let res
    if (type !== 'custom') {
      let serpRes = await fetch(`${Config.githubAPI}/search/${type}?q=${encodeURIComponent(q)}&per_page=${num}`, {
        headers
      })
      serpRes = await serpRes.json()

      res = serpRes
    } else {
      let serpRes = await fetch(`${Config.githubAPI}${fullUrl}`, {
        headers
      })
      serpRes = await serpRes.json()
      res = serpRes
    }

    return `the search results are here in json format:\n${JSON.stringify(res)} \n(Notice that these information are only available for you, the user cannot see them, you next answer should consider about the information)`
  }

  description = 'Useful when you want to search something from api.github.com. You can use preset search types or build your own url path with order, per_page, page and other params. Automatically adjust the query and params if any error messages return.'
}
