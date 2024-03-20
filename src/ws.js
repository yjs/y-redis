import * as Y from 'yjs'
import * as uws from 'uws'
import * as promise from 'lib0/promise'
import * as api from './api.js'
import * as array from 'lib0/array'
import * as encoding from 'lib0/encoding'
import * as protocol from './protocol.js'
import * as logging from 'lib0/logging'
import { createSubscriber } from './subscriber.js'

const log = logging.createModuleLogger('@y/redis/ws')

/**
 * how to sync
 *   receive sync-step 1
 *   // @todo y-websocket should only accept updates after receiving sync-step 2
 *   redisId = ws.sub(conn)
 *   {doc,redisDocLastId} = api.getdoc()
 *   compute sync-step 2
 *   if (redisId > redisDocLastId) {
 *     subscriber.ensureId(redisDocLastId)
 *   }
 */

class YWebsocketServer {
  /**
   * @param {uws.TemplatedApp} app
   * @param {api.Api} client
   * @param {import('./subscriber.js').Subscriber} subscriber
   */
  constructor (app, client, subscriber) {
    this.app = app
    this.subscriber = subscriber
    this.client = client
  }

  async destroy () {
    this.subscriber.destroy()
    await this.client.destroy()
  }
}

let _idCnt = 0

class User {
  /**
   * @param {string} room
   * @param {boolean} hasWriteAccess
   * @param {string} userid identifies the user globally.
   */
  constructor (room, hasWriteAccess, userid) {
    this.room = room
    this.hasWriteAccess = hasWriteAccess
    /**
     * @type {string}
     */
    this.initialRedisSubId = '0'
    this.subs = new Set()
    /**
     * This is just an identifier to keep track of the user for logging purposes.
     */
    this.id = _idCnt++
    /**
     * Identifies the User globally.
     * Note that several clients can have the same userid (e.g. if a user opened several browser
     * windows)
     */
    this.userid = userid
  }
}

/**
 * @param {uws.TemplatedApp} app
 * @param {uws.RecognizedString} pattern
 * @param {import('./storage.js').AbstractStorage} store
 * @param {function(uws.HttpRequest): Promise<{ hasWriteAccess: boolean, room: string, userid: string }>} checkAuth
 * @param {Object} conf
 * @param {string} [conf.redisPrefix]
 */
export const registerYWebsocketServer = async (app, pattern, store, checkAuth, { redisPrefix = 'y' } = {}) => {
  const [client, subscriber] = await promise.all([
    api.createApiClient(store, redisPrefix),
    createSubscriber(store, redisPrefix)
  ])
  /**
   * @param {string} stream
   * @param {Array<Uint8Array>} messages
   */
  const redisMessageSubscriber = (stream, messages) => {
    if (app.numSubscribers(stream) === 0) {
      subscriber.unsubscribe(stream, redisMessageSubscriber)
    }
    const message = messages.length === 1
      ? messages[0]
      : encoding.encode(encoder => messages.forEach(message => {
        encoding.writeUint8Array(encoder, message)
      }))
    app.publish(stream, message, true, false)
  }
  app.ws(pattern, /** @type {uws.WebSocketBehavior<User>} */ ({
    compression: uws.SHARED_COMPRESSOR,
    maxPayloadLength: 100 * 1024 * 1024,
    idleTimeout: 60,
    sendPingsAutomatically: true,
    upgrade: async (res, req, context) => {
      const url = req.getUrl()
      const headerWsKey = req.getHeader('sec-websocket-key')
      const headerWsProtocol = req.getHeader('sec-websocket-protocol')
      const headerWsExtensions = req.getHeader('sec-websocket-extensions')
      let aborted = false
      res.onAborted(() => {
        console.log('Upgrading client aborted', { url })
        aborted = true
      })
      try {
        const { hasWriteAccess, room, userid } = await checkAuth(req)
        if (aborted) return
        res.cork(() => {
          res.upgrade(
            new User(room, hasWriteAccess, userid),
            headerWsKey,
            headerWsProtocol,
            headerWsExtensions,
            context
          )
        })
      } catch (err) {
        console.log(`Failed to auth to endpoint ${url}`, err)
        if (aborted) return
        res.cork(() => {
          res.writeStatus('401 Unauthorized').end('Unauthorized')
        })
      }
    },
    open: async (ws) => {
      const user = ws.getUserData()
      log(() => ['client connected (uid=', user.id, ', ip=', Buffer.from(ws.getRemoteAddressAsText()).toString(), ')'])
      const stream = api.computeRedisRoomStreamName(user.room, 'index', redisPrefix)
      user.subs.add(stream)
      ws.subscribe(stream)
      user.initialRedisSubId = subscriber.subscribe(stream, redisMessageSubscriber).redisId
      const indexDoc = await client.getDoc(user.room, 'index')
      ws.cork(() => {
        ws.send(protocol.encodeSyncStep1(Y.encodeStateVector(indexDoc.ydoc)), true, false)
        ws.send(protocol.encodeSyncStep2(Y.encodeStateAsUpdate(indexDoc.ydoc)), true, true)
        if (indexDoc.awareness.states.size > 0) {
          ws.send(protocol.encodeAwarenessUpdate(indexDoc.awareness, array.from(indexDoc.awareness.states.keys())), true, true)
        }
      })
      if (api.isSmallerRedisId(indexDoc.redisLastId, user.initialRedisSubId)) {
        // our subscription is newer than the content that we received from the api
        // need to renew subscription id and make sure that we catch the latest content.
        subscriber.ensureSubId(stream, indexDoc.redisLastId)
      }
    },
    message: (ws, messageBuffer) => {
      const user = ws.getUserData()
      // don't read any messages from users without write access
      if (!user.hasWriteAccess) return
      // It is important to copy the data here
      const message = Buffer.from(messageBuffer.slice(0, messageBuffer.byteLength))
      if ( // filter out messages that we simply want to propagate to all clients
        // sync update or sync step 2
        (message[0] === protocol.messageSync && (message[1] === protocol.messageSyncUpdate || message[1] === protocol.messageSyncStep2)) ||
        // awareness update
        message[0] === protocol.messageAwareness
      ) {
        client.addMessage(user.room, 'index', message)
      } else if (message[0] === protocol.messageSync && message[1] === protocol.messageSyncStep1) { // sync step 1
        // can be safely ignored because we send the full initial state at the beginning
      } else {
        console.error('Unexpected message type', message)
      }
    },
    close: (ws, code, message) => {
      const user = ws.getUserData()
      log(() => ['client connection closed (uid=', user.id, ', code=', code, ', message="', Buffer.from(message).toString(), '")'])
      user.subs.forEach(topic => {
        if (app.numSubscribers(topic) === 0) {
          subscriber.unsubscribe(topic, redisMessageSubscriber)
        }
      })
    }
  }))
  return new YWebsocketServer(app, client, subscriber)
}
