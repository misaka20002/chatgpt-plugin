import { AbstractTool } from './AbstractTool.js'
import { Config } from '../config.js'

export class GithubAPITool extends AbstractTool {
  name = 'github'

  parameters = {
    properties: {
      q: {
        type: 'string',
        description: 'Search keyword. Use repo:ORG/REPO for specific repo. E.g., windows+label:bug+language:python+state:open&sort=created&order=asc'
      },
      type: {
        type: 'string',
        enum: ['repositories', 'issues', 'users', 'code', 'custom'],
        description: 'Search type. If "custom", provide fullUrl.'
      },
      num: {
        type: 'number',
        description: 'Result limit, default 5.'
      },
      fullUrl: {
        type: 'string',
        description: 'Required if type is "custom". E.g., /repos/OWNER/REPO/actions/artifacts?name=NAME&page=2'
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

  description = 'Search api.github.com via preset types or custom URL paths. Auto-adjust params on error.'
}
