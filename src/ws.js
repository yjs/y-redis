import * as Y from 'yjs'
import * as uws from 'uws'
import * as promise from 'lib0/promise'
import * as error from 'lib0/error'
import * as api from './api.js'
import * as array from 'lib0/array'
import * as encoding from 'lib0/encoding'
import * as protocol from './protocol.js'
import { Subscriber } from './subscriber.js'

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
   * @param {Subscriber} subscriber
   */
  constructor (app, client, subscriber) {
    this.app = app
    this.client = client
    this.subscriber = subscriber
  }

  destroy () {
    this.app.close()
    this.client.destroy()
    this.subscriber.destroy()
  }
}

class User {
  /**
   * @param {string} room
   */
  constructor (room) {
    this.room = room
    /**
     * @type {string}
     */
    this.initialRedisSubId = '0'
  }
}

/**
 * @todo remove
 * @param {Uint8Array} data
 */
const logReturn = data => {
  console.log('sending', data)
  return data
}

/**
 * @param {number} port
 * @param {string} redisUrl
 * @param {import('./storage.js').AbstractStorage} store
 */
export const createYWebsocketServer = async (port, redisUrl, store) => {
  const [client, subscriber] = await promise.all([
    api.createApiClient(redisUrl, store),
    api.createApiClient(redisUrl, store).then(client => new Subscriber(client))
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
  const app = uws.App({})
  app.ws('/*', /** @type {uws.WebSocketBehavior<User>} */ ({
    compression: uws.SHARED_COMPRESSOR,
    maxPayloadLength: 100 * 1024 * 1024,
    idleTimeout: 60,
    sendPingsAutomatically: true,
    upgrade: (res, req, context) => {
      res.upgrade(
        new User(array.last(req.getUrl().split('/'))),
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      )
    },
    open: async (ws) => {
      const user = ws.getUserData()
      const stream = api.computeRedisRoomStreamName(user.room, 'index')
      ws.subscribe(stream)
      user.initialRedisSubId = subscriber.subscribe(stream, redisMessageSubscriber).redisId
      const indexDoc = await client.getDoc(user.room, 'index')
      ws.cork(() => {
        ws.send(logReturn(protocol.encodeSyncStep1(Y.encodeStateVector(indexDoc.ydoc))), true, false)
        ws.send(logReturn(protocol.encodeSyncStep2(Y.encodeStateAsUpdate(indexDoc.ydoc))), true, true)
        if (indexDoc.awareness.states.size > 0) {
          ws.send(logReturn(protocol.encodeAwarenessUpdate(indexDoc.awareness, array.from(indexDoc.awareness.states.keys()))), true, true)
        }
      })
      if (api.isSmallerRedisId(indexDoc.redisLastId, user.initialRedisSubId)) {
        // our subscription is newer than the content that we received from the api
        // need to renew subscription id and make sure that we catch the latest content.
        subscriber.ensureSubId(stream, indexDoc.redisLastId)
      }
    },
    message: (ws, messageBuffer) => {
      const message = Buffer.from(messageBuffer)
      const user = ws.getUserData()
      const indexStream = api.computeRedisRoomStreamName(user.room, 'index')
      if ( // filter out messages that we simply want to propagate to all clients
        // sync update or sync step 2
        (message[0] === protocol.messageSync && (message[1] === protocol.messageSyncUpdate || message[1] === protocol.messageSyncStep2)) ||
        // awareness update
        message[0] === protocol.messageAwareness
      ) {
        client.addMessage(indexStream, 'index', message)
      } else if (message[0] === protocol.messageSync && message[1] === protocol.messageSyncStep1) { // sync step 1
        // can be safely ignored because we send the full initial state at the beginning
      } else {
        console.error('Unexpected message type', message)
      }
    },
    close: (ws, code, message) => {
      console.log(`closing conn. code=${code} message="${message}"`)
      ws.getTopics().forEach(topic => {
        console.log('successfull unsub:', ws.unsubscribe(topic))
        if (app.numSubscribers(topic) === 0) {
          subscriber.unsubscribe(topic, redisMessageSubscriber)
        }
      })
    }
  }))

  app.any('/*', (res, _req) => {
    res.end('<h1>y-redis</h1>')
  })

  await promise.create((resolve, reject) => {
    app.listen(port, (token) => {
      if (token) {
        console.log('Listening to port ' + port)
        resolve()
      } else {
        reject(error.create('Failed to lisen to port ' + port))
      }
    })
  })
  return new YWebsocketServer(app, client, subscriber)
}
