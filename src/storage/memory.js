import * as Y from 'yjs'
import * as map from 'lib0/map'
import * as array from 'lib0/array'
import * as random from 'lib0/random'
import * as promise from 'lib0/promise'

/**
 * @typedef {import('../storage.js').AbstractStorage} AbstractStorage
 */

/**
 * @typedef {Object} MemoryStorageOpts
 */

/**
 * @param {MemoryStorageOpts} opts
 */
export const createMemoryStorage = (opts = {}) => new MemoryStorage(opts)

/**
 * A helper Storage implementation for testing when only using one server. For production use
 * Postgres or something persistent that other clients can also read.
 *
 * @implements {AbstractStorage}
 */
export class MemoryStorage {
  /**
   * @param {MemoryStorageOpts} _opts
   */
  constructor (_opts) {
    /**
     * path := room.compositeKey.referenceid where compositeKey = docid/branch/gc
     * @type {Map<string, Map<string, Map<string, Uint8Array>>>}
     */
    this.docs = new Map()
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @param {Object} opts
   * @param {boolean} [opts.gc]
   * @param {string} [opts.branch]
   * @returns {Promise<void>}
   */
  persistDoc (room, docname, ydoc, { gc = true, branch = 'main' } = {}) {
    const compositeKey = `${docname}/${branch}/${gc}`
    map.setIfUndefined(
      map.setIfUndefined(this.docs, room, map.create),
      compositeKey,
      map.create
    ).set(random.uuidv4(), Y.encodeStateAsUpdateV2(ydoc))
    return promise.resolve()
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Object} opts
   * @param {boolean} [opts.gc]
   * @param {string} [opts.branch]
   * @return {Promise<{ doc: Uint8Array, references: Array<string> } | null>}
   */
  async retrieveDoc (room, docname, { gc = true, branch = 'main' } = {}) {
    const compositeKey = `${docname}/${branch}/${gc}`
    const refs = this.docs.get(room)?.get(compositeKey)
    return promise.resolveWith((refs == null || refs.size === 0) ? null : { doc: Y.mergeUpdatesV2(array.from(refs.values())), references: array.from(refs.keys()) })
  }

  /**
   * This can be implemented by the storage provider for better efficiency. The state vector must be
   * updated when persistDoc is called. Otherwise, we pull the ydoc and compute the state vector.
   *
   * @param {string} room
   * @param {string} docname
   * @param {Object} opts
   * @param {boolean} [opts.gc]
   * @param {string} [opts.branch]
   * @return {Promise<Uint8Array|null>}
   */
  async retrieveStateVector (room, docname, { gc = true, branch = 'main' } = {}) {
    const r = await this.retrieveDoc(room, docname, { gc, branch })
    return r ? Y.encodeStateVectorFromUpdateV2(r.doc) : null
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Array<string>} storeReferences
   * @param {Object} opts
   * @param {boolean} [opts.gc]
   * @param {string} [opts.branch]
   * @return {Promise<void>}
   */
  deleteReferences (room, docname, storeReferences, { gc = true, branch = 'main' } = {}) {
    const compositeKey = `${docname}/${branch}/${gc}`
    storeReferences.forEach(r => {
      this.docs.get(room)?.get(compositeKey)?.delete(r)
    })
    return promise.resolve()
  }

  async destroy () {
  }
}
