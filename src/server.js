import * as uws from 'uws'
import * as env from 'lib0/environment'
import * as logging from 'lib0/logging'
import * as error from 'lib0/error'
import * as jwt from 'lib0/crypto/jwt'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as json from 'lib0/json'
import { registerYWebsocketServer } from '../src/ws.js'
import * as promise from 'lib0/promise'
import * as time from 'lib0/time'

const wsServerPublicKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-public-key')))
const wsServerPrivateKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-private-key')))

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
 */
export const createYWebsocketServer = async ({
  redisPrefix = 'y',
  port,
  store,
  checkPermCallbackUrl
}) => {
  checkPermCallbackUrl += checkPermCallbackUrl.slice(-1) !== '/' ? '/' : ''
  const app = uws.App({})
  await registerYWebsocketServer(app, '/:room', store, async (req) => {
    const room = req.getParameter(0)
    const token = req.getQuery('yauth')
    if (token == null) {
      throw new Error('Missing Token')
    }

    // verify that the user has a valid token
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
  }, { redisPrefix })

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
