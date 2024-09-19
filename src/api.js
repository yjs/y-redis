import { Redis as IoRedis } from 'ioredis'
import * as array from 'lib0/array'
import * as decoding from 'lib0/decoding'
import * as env from 'lib0/environment'
import * as logging from 'lib0/logging'
import * as map from 'lib0/map'
import * as math from 'lib0/math'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as random from 'lib0/random'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'
import * as protocol from './protocol.js'
import { IoRedisAdapter } from './redis/io-redis.js'
import { NodeRedisAdapter } from './redis/node-redis.js'

const logWorker = logging.createModuleLogger('@y/redis/api/worker')
const logApi = logging.createModuleLogger('@y/redis/api')

/**
 * @param {string} a
 * @param {string} b
 * @return {boolean} iff a < b
 */
export const isSmallerRedisId = (a, b) => {
  const [a1, a2 = '0'] = a.split('-')
  const [b1, b2 = '0'] = b.split('-')
  const a1n = number.parseInt(a1)
  const b1n = number.parseInt(b1)
  return a1n < b1n || (a1n === b1n && number.parseInt(a2) < number.parseInt(b2))
}

/**
 * @param {import('@redis/client/dist/lib/commands/generic-transformers.js').StreamsMessagesReply} streamReply
 * @param {string} prefix
 */
const extractMessagesFromStreamReply = (streamReply, prefix) => {
  /**
   * @type {Map<string, Map<string, { lastId: string, messages: Array<Uint8Array> }>>}
  */
  const messages = new Map()
  streamReply?.forEach(docStreamReply => {
    const { room, docid } = decodeRedisRoomStreamName(docStreamReply.name.toString(), prefix)
    const docMessages = map.setIfUndefined(
      map.setIfUndefined(
        messages,
        room,
        map.create
      ),
      docid,
      () => ({ lastId: array.last(docStreamReply.messages).id, messages: /** @type {Array<Uint8Array>} */ ([]) })
    )
    docStreamReply.messages.forEach(m => {
      if (m.message.m != null) {
        docMessages.messages.push(/** @type {Uint8Array} */(m.message.m))
      }
    })
  })
  return messages
}

/**
 * @param {string} room
 * @param {string} docid
 * @param {string} prefix
 */
export const computeRedisRoomStreamName = (room, docid, prefix) => `${prefix}:room:${encodeURIComponent(room)}:${encodeURIComponent(docid)}`

/**
 * @param {string} rediskey
 * @param {string} expectedPrefix
 */
const decodeRedisRoomStreamName = (rediskey, expectedPrefix) => {
  const match = rediskey.match(/^(.*):room:(.*):(.*)$/)
  if (match == null || match[1] !== expectedPrefix) {
    throw new Error(`Malformed stream name! prefix="${match?.[1]}" expectedPrefix="${expectedPrefix}", rediskey="${rediskey}"`)
  }
  return { room: decodeURIComponent(match[2]), docid: decodeURIComponent(match[3]) }
}

/**
 * @param {import('./storage.js').AbstractStorage} store
 * @param {string} redisPrefix
 * @param {() => Promise<import('redis').RedisClientType | import('ioredis').Redis>} createRedisInstance
 */
export const createApiClient = async (store, redisPrefix, createRedisInstance) => {
  const a = new Api(store, redisPrefix, await createRedisInstance())
  try {
    await a.redis.createGroup()
  } catch (e) {
    // It is okay when the group already exists, so we can ignore this error.
    if(e.message !== 'BUSYGROUP Consumer Group name already exists') {
      throw e
    }
  }

  return a
}

export class Api {
  /**
   * @param {import('./storage.js').AbstractStorage} store
   * @param {string} prefix
   * @param {import('redis').RedisClientType | import('ioredis').Redis} redisInstance
   */
  constructor(store, prefix, redisInstance) {
    this.store = store
    this.prefix = prefix
    this.consumername = random.uuidv4()
    /**
     * After this timeout, a worker will pick up a task and clean up a stream.
     */
    this.redisTaskDebounce = number.parseInt(env.getConf('redis-task-debounce') || '10000') // default: 10 seconds
    /**
     * Minimum lifetime of y* update messages in redis streams.
     */
    this.redisMinMessageLifetime = number.parseInt(env.getConf('redis-min-message-lifetime') || '60000') // default: 1 minute
    this._destroyed = false

    if (redisInstance instanceof IoRedis) {
      /**
       * @type {IoRedisAdapter | NodeRedisAdapter}
       */
      this.redis = new IoRedisAdapter(redisInstance, this.prefix)
    } else if (redisInstance.constructor.name === 'Commander') {
      this.redis = new NodeRedisAdapter(redisInstance, this.prefix)
    } else {
      throw new Error('Invalid redis instance');
    }
  }


  /**
   * @param {Array<{key:string,id:string}>} streams streamname-clock pairs
   * @return {Promise<Array<{ stream: string, messages: Array<Uint8Array>, lastId: string }>>}
   */
  async getMessages(streams) {
    if (streams.length === 0) {
      await promise.wait(50)
      return []
    }

    const streamReplyRes = await this.redis.readStreams(streams)

    /**
     * @type {{ stream: string; messages: Array<Uint8Array>; lastId: string; }[] | PromiseLike<{ stream: string; messages: Array<Uint8Array>; lastId: string; }[]>}
     */
    const res = []
    streamReplyRes?.forEach((stream) => {
      res.push({
        stream: stream.name.toString(),
        // @ts-ignore
        messages: protocol.mergeMessages(stream.messages.map(message => message.message.m).filter(m => m != null)),
        lastId: array.last(stream.messages).id.toString()
      })
    })
    return res
  }

  /**
   * @param {string} room
   * @param {string} docid
   * @param {Buffer} m
   */
  addMessage(room, docid, m) {
    // handle sync step 2 like a normal update message
    if (m[0] === protocol.messageSync && m[1] === protocol.messageSyncStep2) {
      if (m.byteLength < 4) {
        // message does not contain any content, don't distribute
        return promise.resolve()
      }
      m[1] = protocol.messageSyncUpdate
    }

    return this.redis.addMessage(computeRedisRoomStreamName(room, docid, this.prefix), m)
  }

  /**
   * @param {string} room
   * @param {string} docid
   */
  async getStateVector(room, docid = '/') {
    return this.store.retrieveStateVector(room, docid)
  }

  /**
   * @param {string} room
   * @param {string} docid
   */
  async getDoc(room, docid) {
    logApi(`getDoc(${room}, ${docid})`)
    const ms = extractMessagesFromStreamReply(
      await this.redis.readMessagesFromStream(computeRedisRoomStreamName(room, docid, this.prefix)),
      this.prefix
    )
    logApi(`getDoc(${room}, ${docid}) - retrieved messages`)
    const docMessages = ms.get(room)?.get(docid) || null
    const docstate = await this.store.retrieveDoc(room, docid)
    logApi(`getDoc(${room}, ${docid}) - retrieved doc`)
    const ydoc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(ydoc)
    awareness.setLocalState(null) // we don't want to propagate awareness state
    if (docstate) { Y.applyUpdateV2(ydoc, docstate.doc) }
    let docChanged = false
    ydoc.once('afterTransaction', tr => {
      docChanged = tr.changed.size > 0
    })
    ydoc.transact(() => {
      docMessages?.messages.forEach(m => {
        const decoder = decoding.createDecoder(m)
        switch (decoding.readVarUint(decoder)) {
          case 0: { // sync message
            if (decoding.readVarUint(decoder) === 2) { // update message
              Y.applyUpdate(ydoc, decoding.readVarUint8Array(decoder))
            }
            break
          }
          case 1: { // awareness message
            awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), null)
            break
          }
        }
      })
    })
    return { ydoc, awareness, redisLastId: docMessages?.lastId.toString() || '0', storeReferences: docstate?.references || null, docChanged }
  }

  /**
   * @param {WorkerOpts} opts
   */
  async consumeWorkerQueue({ tryClaimCount = 5, updateCallback = async () => {} }) {
    /**
     * @type {Array<{stream: string, id: string}>}
     */
    const tasks = []

    const reclaimedTasks = await this.redis.reclaimTasks(this.consumername, this.redisTaskDebounce, tryClaimCount)
    const deletedDocEntries = await this.redis.getDeletedDocEntries()
    const deletedDocNames = deletedDocEntries?.map(entry => {
      return entry.message.docName
    })

    reclaimedTasks?.messages.forEach(m => {
      const stream = m?.message.compact
      stream && tasks.push({ stream: stream.toString(), id: m?.id.toString() })
    })
    if (tasks.length === 0) {
      logWorker('No tasks available, pausing..', { tasks })
      await promise.wait(1000)
      return []
    }
    logWorker('Accepted tasks ', { tasks })
    await promise.all(tasks.map(async task => {
      const streamlen = await this.redis.tryClearTask(task)
      const { room, docid } = decodeRedisRoomStreamName(task.stream, this.prefix)
      if (streamlen === 0) {
        logWorker('Stream still empty, removing recurring task from queue ', { stream: task.stream })

        const deleteEntryId = deletedDocEntries.find(entry => entry.message.docName === task.stream)?.id.toString()

        if (deleteEntryId) {
           this.redis.deleteDeleteDocEntry(deleteEntryId)
           this.store.deleteDocument(room, docid)
        }
      } else {
        // @todo, make sure that awareness by this.getDoc is eventually destroyed, or doesn't
        // register a timeout anymore
        logWorker('requesting doc from store')
        const { ydoc, storeReferences, redisLastId, docChanged, awareness } = await this.getDoc(room, docid)

        // awareness is destroyed here to avoid memory leaks, see: https://github.com/yjs/y-redis/issues/24
        awareness.destroy()
        logWorker('retrieved doc from store. redisLastId=' + redisLastId, ' storeRefs=' + JSON.stringify(storeReferences))
        const lastId = math.max(number.parseInt(redisLastId.split('-')[0]), number.parseInt(task.id.split('-')[0]))
        if (docChanged) {
          try {
            logWorker('doc changed, calling update callback')
            await updateCallback(room, ydoc)
          } catch (e) {
            console.error(e)
          }

          logWorker('persisting doc')
          if(!deletedDocNames.includes(task.stream)) {
            await this.store.persistDoc(room, docid, ydoc)
          }
        }
        await promise.all([
          storeReferences && docChanged ? this.store.deleteReferences(room, docid, storeReferences) : promise.resolve(),
          this.redis.tryDeduplicateTask(task, lastId, this.redisMinMessageLifetime)
        ])
        logWorker('Compacted stream ', { stream: task.stream, taskId: task.id, newLastId: lastId - this.redisMinMessageLifetime })
      }
    }))
    return tasks
  }

  async destroy() {
    this._destroyed = true
    try {
      await this.redis.quit()
    } catch (e) {
      console.error(e)
    }
  }
}

/**
 * @typedef {Object} WorkerOpts
 * @property {(room: string, ydoc: Y.Doc) => Promise<void>} [WorkerOpts.updateCallback]
 * @property {number} [WorkerOpts.tryClaimCount]
 */

/**
 * @param {import('./storage.js').AbstractStorage} store
 * @param {string} redisPrefix
 * @param {WorkerOpts} opts
 * @param {() => Promise<import('redis').RedisClientType | import('ioredis').Redis>} createRedisInstance
 */
export const createWorker = async (store, redisPrefix, opts, createRedisInstance) => {
  const a = await createApiClient(store, redisPrefix, createRedisInstance)
  return new Worker(a, opts)
}

export class Worker {
  /**
   * @param {Api} client
   * @param {WorkerOpts} opts
   */
  constructor(client, opts) {
    this.client = client
    logWorker('Created worker process ', { id: client.consumername, prefix: client.prefix, minMessageLifetime: client.redisMinMessageLifetime })
    ;(async () => {
      while (!client._destroyed) {
        try {
          await client.consumeWorkerQueue(opts)
        } catch (e) {
          console.error(e)
        }
      }
      logWorker('Ended worker process ', { id: client.consumername })
    })()
  }
}
