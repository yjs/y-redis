import * as Y from 'yjs'
import * as redis from 'redis'
import * as map from 'lib0/map'
import * as decoding from 'lib0/decoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as array from 'lib0/array'
import * as random from 'lib0/random'
import * as number from 'lib0/number'
import * as promise from 'lib0/promise'
import * as math from 'lib0/math'
import * as protocol from './protocol.js'
import * as env from 'lib0/environment'
import * as logging from 'lib0/logging'
import * as time from 'lib0/time'

const logWorker = logging.createModuleLogger('@y/redis/api/worker')
const logApi = logging.createModuleLogger('@y/redis/api')

export const redisUrl = env.ensureConf('redis')

let ydocUpdateCallback = env.getConf('ydoc-update-callback')
if (ydocUpdateCallback != null && ydocUpdateCallback.slice(-1) !== '/') {
  ydocUpdateCallback += '/'
}

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
        docMessages.messages.push(/** @type {Uint8Array} */ (m.message.m))
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
 */
export const createApiClient = async (store, redisPrefix) => {
  const a = new Api(store, redisPrefix)
  await a.redis.connect()
  try {
    await a.redis.xGroupCreate(a.redisWorkerStreamName, a.redisWorkerGroupName, '0', { MKSTREAM: true })
  } catch (e) { }
  return a
}

export class Api {
  /**
   * @param {import('./storage.js').AbstractStorage} store
   * @param {string} prefix
   */
  constructor (store, prefix) {
    this.store = store
    this.prefix = prefix
    this.consumername = random.uuidv4()
    /**
     * After this timeout, a new worker will pick up the task
     * @todo rename this variable
     */
    this.redisWorkerTimeout = number.parseInt(env.getConf('redis-task-timeout') || '600000')
    /**
     * Minimum lifetime of y* update messages in redis streams.
     */
    this.redisMinMessageLifetime = number.parseInt(env.getConf('redis-min-message-lifetime') || '60000')
    this.redisWorkerStreamName = this.prefix + ':worker'
    this.redisWorkerGroupName = this.prefix + ':worker'
    this._destroyed = false
    this.redis = redis.createClient({
      url: redisUrl,
      // scripting: https://github.com/redis/node-redis/#lua-scripts
      scripts: {
        addMessage: redis.defineScript({
          NUMBER_OF_KEYS: 1,
          SCRIPT: `
            if redis.call("EXISTS", KEYS[1]) == 0 then
              redis.call("XADD", "${this.redisWorkerStreamName}", "*", "compact", KEYS[1])
            end
            redis.call("XADD", KEYS[1], "*", "m", ARGV[1])
          `,
          /**
           * @param {string} key
           * @param {Buffer} message
           */
          transformArguments (key, message) {
            return [key, message]
          },
          /**
           * @param {null} x
           */
          transformReply (x) {
            return x
          }
        }),
        xDelIfEmpty: redis.defineScript({
          NUMBER_OF_KEYS: 1,
          SCRIPT: `
            if redis.call("XLEN", KEYS[1]) == 0 then
              redis.call("DEL", KEYS[1])
            end
          `,
          /**
           * @param {string} key
           */
          transformArguments (key) {
            return [key]
          },
          /**
           * @param {null} x
           */
          transformReply (x) {
            return x
          }
        })
      }
    })
  }

  /**
   * @param {Array<{key:string,id:string}>} streams streamname-clock pairs
   * @return {Promise<Array<{ stream: string, messages: Array<Uint8Array>, lastId: string }>>}
   */
  async getMessages (streams) {
    if (streams.length === 0) {
      await promise.wait(50)
      return []
    }
    const reads = await this.redis.xRead(
      redis.commandOptions({ returnBuffers: true }),
      streams,
      { BLOCK: 1000, COUNT: 1000 }
    )
    /**
     * @type {Array<{ stream: string, messages: Array<Uint8Array>, lastId: string }>}
     */
    const res = []
    reads?.forEach(stream => {
      res.push({
        stream: stream.name.toString(),
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
  addMessage (room, docid, m) {
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
  async getStateVector (room, docid = '/') {
    return this.store.retrieveStateVector(room, docid)
  }

  /**
   * @param {string} room
   * @param {string} docid
   */
  async getDoc (room, docid) {
    const ms = extractMessagesFromStreamReply(await this.redis.xRead(redis.commandOptions({ returnBuffers: true }), { key: computeRedisRoomStreamName(room, docid, this.prefix), id: '0' }), this.prefix)
    const docMessages = ms.get(room)?.get(docid) || null
    const docstate = await this.store.retrieveDoc(room, docid)
    const ydoc = new Y.Doc()
    const awareness = new awarenessProtocol.Awareness(ydoc)
    awareness.setLocalState(null) // we don't want to propagate awareness state
    ydoc.transact(() => {
      if (docstate) { Y.applyUpdateV2(ydoc, docstate.doc) }
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
    return { ydoc, awareness, redisLastId: docMessages?.lastId.toString() || '0', storeReferences: docstate?.references || null }
  }

  /**
   * @param {Object} opts
   * @param {number} [opts.blockTime]
   * @param {number} [opts.tryReclaimCount]
   * @param {number} [opts.tryClaimCount]
   */
  async consumeWorkerQueue ({ blockTime = 1000, tryReclaimCount = 5, tryClaimCount = 5 } = {}) {
    /**
     * @type {Array<{stream: string, id: string}>}
     */
    const tasks = []
    if (tryReclaimCount > 0) {
      const reclaimedTasks = await this.redis.xAutoClaim(this.redisWorkerStreamName, this.redisWorkerGroupName, this.consumername, this.redisWorkerTimeout, '0', { COUNT: tryReclaimCount })
      reclaimedTasks.messages.forEach(m => {
        const stream = m?.message.compact
        stream && tasks.push({ stream, id: m?.id })
      })
    }
    if (tryClaimCount > 0) {
      const claimedTasks = await this.redis.xReadGroup(this.redisWorkerGroupName, this.consumername, { key: this.redisWorkerStreamName, id: '>' }, { COUNT: tryClaimCount - tasks.length, BLOCK: tasks.length === 0 ? blockTime : undefined })
      claimedTasks?.forEach(task => {
        task.messages.forEach(message => {
          const stream = message.message.compact
          stream && tasks.push({ stream, id: message.id })
        })
      })
    }
    tasks.length > 0 && logWorker('Accepted tasks ', { tasks })
    await promise.all(tasks.map(async task => {
      const streamlen = await this.redis.xLen(task.stream)
      if (streamlen === 0) {
        await this.redis.multi()
          .xDelIfEmpty(task.stream)
          .xDel(this.redisWorkerStreamName, task.id)
          .exec()
        logWorker('Stream still empty, removing recurring task from queue ', { stream: task.stream })
      } else {
        const { room, docid } = decodeRedisRoomStreamName(task.stream, this.prefix)
        const { ydoc, storeReferences, redisLastId } = await this.getDoc(room, docid)
        const lastId = math.max(number.parseInt(redisLastId.split('-')[0]), number.parseInt(task.id.split('-')[0]))
        await this.store.persistDoc(room, docid, ydoc)
        await promise.all([
          storeReferences ? this.store.deleteReferences(room, docid, storeReferences) : promise.resolve(),
          this.redis.multi()
            .xTrim(task.stream, 'MINID', lastId - this.redisMinMessageLifetime)
            .xAdd(this.redisWorkerStreamName, '*', { compact: task.stream })
            .xDel(this.redisWorkerStreamName, task.id)
            .exec()
        ])
        logWorker('Compacted stream ', { stream: task.stream, taskId: task.id, newLastId: lastId - this.redisMinMessageLifetime })
        try {
          if (ydocUpdateCallback != null) {
            // call YDOC_UPDATE_CALLBACK here
            const formData = new FormData()
            // @todo only convert ydoc to updatev2 once
            formData.append('ydoc', new Blob([Y.encodeStateAsUpdateV2(ydoc)]))
            // @todo should add a timeout to fetch (see fetch signal abortcontroller)
            const res = await fetch(new URL(room, ydocUpdateCallback), { body: formData, method: 'PUT' })
            if (!res.ok) {
              console.error(`Issue sending data to YDOC_UPDATE_CALLBACK. status="${res.status}" statusText="${res.statusText}"`)
            }
          }
        } catch (e) {
          console.error(e)
        }
      }
    }))
    return tasks
  }

  async destroy () {
    this._destroyed = true
    try {
      await this.redis.quit()
    } catch (e) {}
  }
}

/**
 * @param {import('./storage.js').AbstractStorage} store
 * @param {string} redisPrefix
 */
export const createWorker = async (store, redisPrefix) => {
  const a = await createApiClient(store, redisPrefix)
  return new Worker(a)
}

export class Worker {
  /**
   * @param {Api} client
   */
  constructor (client) {
    this.client = client
    logWorker('Created worker process ', { id: client.consumername, prefix: client.prefix, minMessageLifetime: client.redisMinMessageLifetime })
    ;(async () => {
      const startRedisTime = await client.redis.time()
      const timeDiff = startRedisTime.getTime() - time.getUnixTime()
      while (!client._destroyed) {
        try {
          const tasks = await client.consumeWorkerQueue()
          if (tasks.length === 0 || (client.redisMinMessageLifetime > time.getUnixTime() + timeDiff - number.parseInt(tasks[0].id.split('-')[0]))) {
            await promise.wait(client.redisMinMessageLifetime / 2)
          }
        } catch (e) {
          console.error(e)
        }
      }
      logWorker('Ended worker process ', { id: client.consumername })
    })()
  }
}
