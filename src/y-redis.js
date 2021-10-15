import * as Y from 'yjs'
import * as mutex from 'lib0/mutex'
import { Observable } from 'lib0/observable'
import * as promise from 'lib0/promise'
import * as error from 'lib0/error'
import * as logging from 'lib0/logging'
import Redis from 'ioredis'

const logger = logging.createModuleLogger('y-redis')

/**
 * Handles persistence of a sinle doc.
 */
export class PersistenceDoc {
  /**
   * @param {RedisPersistence} rp
   * @param {string} name
   * @param {Y.Doc} doc
   */
  constructor (rp, name, doc) {
    this.rp = rp
    this.name = name
    this.doc = doc
    this.mux = mutex.createMutex()
    /**
     * Next expected index / len of the list of updates
     * @type {number}
     */
    this._clock = 0
    this._fetchingClock = 0
    /**
     * @param {Uint8Array} update
     */
    this.updateHandler = update => {
      // mux: only store update in redis if this document update does not originate from redis
      this.mux(() => {
        rp.redis.rpushBuffer(name + ':updates', Buffer.from(update)).then(len => {
          if (len === this._clock + 1) {
            this._clock++
            if (this._fetchingClock < this._clock) {
              this._fetchingClock = this._clock
            }
          }
          // @ts-ignore
          rp.redis.publish(this.name, len.toString())
        })
      })
    }
    if (doc.store.clients.size > 0) {
      this.updateHandler(Y.encodeStateAsUpdate(doc))
    }
    doc.on('update', this.updateHandler)
    this.synced = rp.sub.subscribe(name).then(() => this.getUpdates())
  }

  /**
   * @return {Promise<any>}
   */
  destroy () {
    this.doc.off('update', this.updateHandler)
    this.rp.docs.delete(this.name)
    return this.rp.sub.unsubscribe(this.name)
  }

  /**
   * Get all new updates from redis and increase clock if necessary.
   *
   * @return {Promise<PersistenceDoc>}
   */
  getUpdates () {
    const startClock = this._clock
    return this.rp.redis.lrangeBuffer(this.name + ':updates', startClock, -1).then(/** @type {function(Array<Buffer>)} */ updates => {
      logger('Fetched ', logging.BOLD, logging.PURPLE, (updates.length).toString().padEnd(2), logging.UNBOLD, logging.UNCOLOR, ' updates')
      this.mux(() => {
        this.doc.transact(() => {
          updates.forEach(update => {
            Y.applyUpdate(this.doc, update)
          })
          const nextClock = startClock + updates.length
          if (this._clock < nextClock) {
            this._clock = nextClock
          }
          if (this._fetchingClock < this._clock) {
            this._fetchingClock = this._clock
          }
        })
      })
      if (this._fetchingClock <= this._clock) {
        return this
      } else {
        // there is still something missing. new updates came in. fetch again.
        if (updates.length === 0) {
          // Calling getUpdates recursively has the potential to be an infinite fetch-call.
          // In case no new updates came in, reset _fetching clock (in case the pubsub lied / send an invalid message).
          // Being overly protective here..
          this._fetchingClock = this._clock
        }
        return this.getUpdates()
      }
    })
  }
}

/**
 * @param {Object|null} redisOpts
 * @param {Array<Object>|null} redisClusterOpts
 * @return {Redis.Redis | Redis.Cluster}
 */
const createRedisInstance = (redisOpts, redisClusterOpts) => redisClusterOpts
  ? new Redis.Cluster(redisClusterOpts)
  : (redisOpts ? new Redis(redisOpts) : new Redis())

/**
 * @extends Observable<string>
 */
export class RedisPersistence extends Observable {
  /**
   * @param {Object} [opts]
   * @param {Object|null} [opts.redisOpts]
   * @param {Array<Object>|null} [opts.redisClusterOpts]
   */
  constructor ({ redisOpts = /** @type {any} */ (null), redisClusterOpts = /** @type {any} */ (null) } = {}) {
    super()
    this.redis = createRedisInstance(redisOpts, redisClusterOpts)
    this.sub = /** @type {Redis.Redis} */ (createRedisInstance(redisOpts, redisClusterOpts))
    /**
     * @type {Map<string,PersistenceDoc>}
     */
    this.docs = new Map()
    this.sub.on('message', (channel, sclock) => {
      // console.log('message', channel, sclock)
      const pdoc = this.docs.get(channel)
      if (pdoc) {
        const clock = Number(sclock) || Number.POSITIVE_INFINITY // case of null
        if (pdoc._fetchingClock < clock) {
          // do not query doc updates if this document is currently already fetching
          const isCurrentlyFetching = pdoc._fetchingClock !== pdoc._clock
          if (pdoc._fetchingClock < clock) {
            pdoc._fetchingClock = clock
          }
          if (!isCurrentlyFetching) {
            pdoc.getUpdates()
          }
        }
      } else {
        this.sub.unsubscribe(channel)
      }
    })
  }

  /**
   * @param {string} name
   * @param {Y.Doc} ydoc
   * @return {PersistenceDoc}
   */
  bindState (name, ydoc) {
    if (this.docs.has(name)) {
      throw error.create(`"${name}" is already bound to this RedisPersistence instance`)
    }
    const pd = new PersistenceDoc(this, name, ydoc)
    this.docs.set(name, pd)
    return pd
  }

  destroy () {
    const docs = this.docs
    this.docs = new Map()
    return promise.all(Array.from(docs.values()).map(doc => doc.destroy())).then(() => {
      this.redis.quit()
      this.sub.quit()
      // @ts-ignore
      this.redis = null
      // @ts-ignore
      this.sub = null
    })
  }

  /**
   * @param {string} name
   */
  closeDoc (name) {
    const doc = this.docs.get(name)
    if (doc) {
      return doc.destroy()
    }
  }

  /**
   * @param {string} name
   * @return {Promise<any>}
   */
  clearDocument (name) {
    const doc = this.docs.get(name)
    if (doc) {
      doc.destroy()
    }
    return this.redis.del(name + ':updates')
  }

  /**
   * Destroys this instance and removes all known documents from the database.
   * After that this Persistence instance is destroyed.
   *
   * @return {Promise<any>}
   */
  clearAllDocuments () {
    return promise.all(Array.from(this.docs.keys()).map(name => this.redis.del(name + ':updates'))).then(() => {
      this.destroy()
    })
  }
}
