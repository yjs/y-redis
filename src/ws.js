import * as array from 'lib0/array'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as logging from 'lib0/logging'
import * as promise from 'lib0/promise'
import * as uws from 'uws'
import * as Y from 'yjs'
import * as api from './api.js'
import * as protocol from './protocol.js'
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
  constructor(app, client, subscriber) {
    this.app = app
    this.subscriber = subscriber
    this.client = client
  }

  async destroy() {
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
  constructor(room, hasWriteAccess, userid) {
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
    /**
     * @type {number|null}
     */
    this.awarenessId = null
    this.awarenessLastClock = 0
    this.isClosed = false
  }
}

/**
 * @param {uws.TemplatedApp} app
 * @param {uws.RecognizedString} pattern
 * @param {import('./storage.js').AbstractStorage} store
 * @param {function(uws.HttpRequest): Promise<{ hasWriteAccess: boolean, room: string, userid: string }>} checkAuth
 * @param {Object} conf
 * @param {string} [conf.redisPrefix]
 * @param {(room:string,docname:string,client:api.Api)=>void} [conf.initDocCallback] - this is called when a doc is
 * accessed, but it doesn't exist. You could populate the doc here. However, this function could be
 * called several times, until some content exists. So you need to handle concurrent calls.
 * @param {(ws:uws.WebSocket<User>)=>void} [conf.openWsCallback] - called when a websocket connection is opened
 * @param {(ws:uws.WebSocket<User>,code:number,message:ArrayBuffer)=>void} [conf.closeWsCallback] - called when a websocket connection is closed
 * @param {import('redis').RedisClientType | import('ioredis').Redis} redisInstance
 */
export const registerYWebsocketServer = async (
  app,
  pattern,
  store,
  checkAuth,
  { redisPrefix = 'y', initDocCallback = () => { }, openWsCallback = () => { }, closeWsCallback = () => { } } = {},
  redisInstance,
) => {
  const [client, subscriber] = await promise.all([
    api.createApiClient(store, redisPrefix, redisInstance),
    createSubscriber(store, redisPrefix, redisInstance)
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
  app.ws(pattern, /** @type {uws.WebSocketBehavior<User>} */({
    compression: uws.SHARED_COMPRESSOR,
    maxPayloadLength: 100 * 1024 * 1024,
    idleTimeout: 60,
    sendPingsAutomatically: true,
    upgrade: async (res, req, context) => {
      try {
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
      } catch (error) {
        res.cork(() => {
          res.writeStatus('500 Internal Server Error').end('Internal Server Error')
        })
        console.error(error)
      }
    },
    open: async (ws) => {
      try {
        const user = ws.getUserData()
        log(() => ['client connected (uid=', user.id, ', ip=', Buffer.from(ws.getRemoteAddressAsText()).toString(), ')'])
        openWsCallback(ws);
        const stream = api.computeRedisRoomStreamName(user.room, 'index', redisPrefix)
        user.subs.add(stream)
        ws.subscribe(stream)
        user.initialRedisSubId = subscriber.subscribe(stream, redisMessageSubscriber).redisId
        const indexDoc = await client.getDoc(user.room, 'index')
        if (indexDoc.ydoc.store.clients.size === 0) {
          initDocCallback(user.room, 'index', client)
        }
        if (user.isClosed) return
        ws.cork(() => {
          ws.send(protocol.encodeSyncStep1(Y.encodeStateVector(indexDoc.ydoc)), true, false)
          ws.send(protocol.encodeSyncStep2(Y.encodeStateAsUpdate(indexDoc.ydoc)), true, true)
          if (indexDoc.awareness.states.size > 0) {
            ws.send(protocol.encodeAwarenessUpdate(indexDoc.awareness, array.from(indexDoc.awareness.states.keys())), true, true)
          }
        })

        // awareness is destroyed here to avoid memory leaks, see: https://github.com/yjs/y-redis/issues/24
        indexDoc.awareness.destroy()

        if (api.isSmallerRedisId(indexDoc.redisLastId, user.initialRedisSubId)) {
          // our subscription is newer than the content that we received from the api
          // need to renew subscription id and make sure that we catch the latest content.
          subscriber.ensureSubId(stream, indexDoc.redisLastId)
        }
      } catch (error) {
        console.error(error)
        ws.end(1011)
      }
    },
    message: (ws, messageBuffer) => {
      try {
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
          if (message[0] === protocol.messageAwareness) {
            const decoder = decoding.createDecoder(message)
            decoding.readVarUint(decoder) // read message type
            decoding.readVarUint(decoder) // read length of awareness update
            const alen = decoding.readVarUint(decoder) // number of awareness updates
            const awId = decoding.readVarUint(decoder)
            if (alen === 1 && (user.awarenessId === null || user.awarenessId === awId)) { // only update awareness if len=1
              user.awarenessId = awId
              user.awarenessLastClock = decoding.readVarUint(decoder)
            }
          }
          client.addMessage(user.room, 'index', message)
        } else if (message[0] === protocol.messageSync && message[1] === protocol.messageSyncStep1) { // sync step 1
          // can be safely ignored because we send the full initial state at the beginning
        } else {
          console.error('Unexpected message type', message)
        }
      } catch (error) {
        console.error(error)
        ws.end(1011)
      }
    },
    close: (ws, code, message) => {
      try {
        const user = ws.getUserData()
        user.awarenessId && client.addMessage(user.room, 'index', Buffer.from(protocol.encodeAwarenessUserDisconnected(user.awarenessId, user.awarenessLastClock)))
        user.isClosed = true
        log(() => ['client connection closed (uid=', user.id, ', code=', code, ', message="', Buffer.from(message).toString(), '")'])
        closeWsCallback(ws, code, message);
        user.subs.forEach(topic => {
          if (app.numSubscribers(topic) === 0) {
            subscriber.unsubscribe(topic, redisMessageSubscriber)
          }
        })
      } catch (error) {
        console.error(error)
      }
    }
  }))
  return new YWebsocketServer(app, client, subscriber)
}
