import * as ecdsa from 'lib0/crypto/ecdsa'
import * as jwt from 'lib0/crypto/jwt'
import * as env from 'lib0/environment'
import * as error from 'lib0/error'
import * as json from 'lib0/json'
import * as logging from 'lib0/logging'
import * as promise from 'lib0/promise'
import * as uws from 'uws'
import { registerYWebsocketServer } from '../src/ws.js'

class YWebsocketServer {
  /**
   * @param {uws.TemplatedApp} app
   */
  constructor (app) {
    this.app = app
  }

  async destroy () {
    this.app.close()
  }
}

/**
 * @param {Object} opts
 * @param {number} opts.port
 * @param {import('./storage.js').AbstractStorage} opts.store
 * @param {string} [opts.redisPrefix]
 * @param {string} opts.checkPermCallbackUrl
 * @param {(room:string,docname:string,client:import('./api.js').Api)=>void} [opts.initDocCallback] -
 * this is called when a doc is accessed, but it doesn't exist. You could populate the doc here.
 * However, this function could be called several times, until some content exists. So you need to
 * handle concurrent calls.
 * @param {import('redis').RedisClientType | import('ioredis').Redis} opts.redisInstance
 */
export const createYWebsocketServer = async ({
  redisPrefix = 'y',
  port,
  store,
  checkPermCallbackUrl,
  initDocCallback = () => {},
  redisInstance
}) => {
  checkPermCallbackUrl += checkPermCallbackUrl.slice(-1) !== '/' ? '/' : ''
  const app = uws.App({})
  await registerYWebsocketServer(app, '/:room', store, async (req) => {
    const room = req.getParameter(0)
    const headerWsProtocol = req.getHeader('sec-websocket-protocol')
    const [, , token] = /(^|,)yauth-(((?!,).)*)/.exec(headerWsProtocol) ?? [null, null, req.getQuery('yauth')]
    if (token == null) {
      throw new Error('Missing Token')
    }
    // verify that the user has a valid token
    const wsServerPublicKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-public-key')))
    const { payload: userToken } = await jwt.verifyJwt(wsServerPublicKey, token)
    if (userToken.yuserid == null) {
      throw new Error('Missing userid in user token!')
    }
    const permUrl = new URL(`${room}/${userToken.yuserid}`, checkPermCallbackUrl)
    try {
      const perm = await fetch(permUrl).then(req => req.json())
      return { hasWriteAccess: perm.yaccess === 'rw', room, userid: perm.yuserid || '' }
    } catch (e) {
      console.error('Failed to pull permissions from', { permUrl })
      throw e
    }
  }, { redisPrefix, initDocCallback }, redisInstance)

  await promise.create((resolve, reject) => {
    app.listen(port, (token) => {
      if (token) {
        logging.print(logging.GREEN, '[y-redis] Listening to port ', port)
        resolve()
      } else {
        const err = error.create('[y-redis] Failed to lisen to port ' + port)
        reject(err)
        throw err
      }
    })
  })
  return new YWebsocketServer(app)
}
