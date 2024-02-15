import * as Y from 'yjs'
import * as err from 'lib0/error'

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
   * @return {Promise<{ doc: Uint8Array, references: Array<any> }|null>}
   */
  retrieveDoc (_room, _docname) {
    err.methodUnimplemented()
  }

  /**
   * This can be implemented by the storage provider for better efficiency. The state vector must be
   * updated when persistDoc is called. Otherwise, we pull the ydoc and compute the state vector.
   *
   * @param {string} room
   * @param {string} docname
   * @return {Promise<Uint8Array|null>}
   */
  async retrieveStateVector (room, docname) {
    const r = await this.retrieveDoc(room, docname)
    return r ? Y.encodeStateVectorFromUpdateV2(r.doc) : null
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Array<any>} _storeReferences
   * @return {Promise<void>}
   */
  deleteReferences (_room, _docname, _storeReferences) {
    err.methodUnimplemented()
  }

  async destroy () {
  }
}
