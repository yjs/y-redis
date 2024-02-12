import * as Y from 'yjs'
import * as err from 'lib0/error'
import * as map from 'lib0/map'
import * as promise from 'lib0/promise'
import * as random from 'lib0/random'
import * as array from 'lib0/array'
import * as json from 'lib0/json'

export class AbstractStorage {
  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Y.Doc} _ydoc
   * @return {Promise<void>}
   */
  persistDoc (_room, _docname, _ydoc) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @return {Promise<{ doc: Uint8Array, references: Array<string> }|null>}
   */
  retrieveDoc (_room, _docname) {
    err.methodUnimplemented()
  }

  /**
   * This can be implemented by the storage provider for better efficiency. The state vector must be
   * updated when persistDoc is called. Otherwise, we pull the ydoc and compute the state vector.
   *
   * @param {string} _room
   * @param {string} _docname
   * @return {Promise<Uint8Array|null>}
   */
  retrieveStateVector (_room, _docname) {
    return this.retrieveDoc(_room, _docname).then(r => r && Y.encodeStateVectorFromUpdate(r.doc))
  }

  /**
   * @param {Array<string>} _storeReferences
   * @return {Promise<void>}
   */
  deleteReferences (_storeReferences) {
    err.methodUnimplemented()
  }
}

/**
 * A helper Storage implementation for testing when only using one server. For production use
 * Postgres or something persistent that other clients can also read.
 *
 * @implements AbstractStorage
 */
export class MemoryStorage {
  constructor () {
    /**
     * path := room.docid.referenceid
     * @type {Map<string, Map<string, Map<string, Uint8Array>>>}
     */
    this.docs = new Map()
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @returns {Promise<void>}
   */
  persistDoc (room, docname, ydoc) {
    map.setIfUndefined(
      map.setIfUndefined(this.docs, room, map.create),
      docname,
      map.create
    ).set(random.uuidv4(), Y.encodeStateAsUpdateV2(ydoc))
    return promise.resolve()
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<{ doc: Uint8Array, references: Array<string> } | null>}
   */
  retrieveDoc (room, docname) {
    const refs = this.docs.get(room)?.get(docname)
    return promise.resolveWith(refs == null ? null : { doc: Y.mergeUpdatesV2(array.from(refs.values())), references: array.from(refs.keys()).map(k => json.stringify([room, docname, k])) })
  }

  /**
   * This can be implemented by the storage provider for better efficiency. The state vector must be
   * updated when persistDoc is called. Otherwise, we pull the ydoc and compute the state vector.
   *
   * @param {string} _room
   * @param {string} _docname
   * @return {Promise<Uint8Array|null>}
   */
  retrieveStateVector (_room, _docname) {
    return this.retrieveDoc(_room, _docname).then(r => r && Y.encodeStateVectorFromUpdate(r.doc))
  }

  /**
   * @param {Array<string>} storeReferences
   * @return {Promise<void>}
   */
  deleteReferences (storeReferences) {
    storeReferences.forEach(r => {
      const [room, docid, ref] = json.parse(r)
      this.docs.get(room)?.get(docid)?.delete(ref)
    })
    return promise.resolve()
  }
}
