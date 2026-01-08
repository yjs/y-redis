import * as Y from 'yjs'
import * as err from 'lib0/error'

export class AbstractStorage {
  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Y.Doc} _ydoc
   * @param {Object} [_opts]
   * @param {boolean} [_opts.gc]
   * @param {string} [_opts.branch]
   * @return {Promise<void>}
   */
  persistDoc (_room, _docname, _ydoc, _opts) {
    err.methodUnimplemented()
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Object} [_opts]
   * @param {boolean} [_opts.gc]
   * @param {string} [_opts.branch]
   * @return {Promise<{ doc: Uint8Array, references: Array<any> }|null>}
   */
  retrieveDoc (_room, _docname, _opts) {
    err.methodUnimplemented()
  }

  /**
   * This can be implemented by the storage provider for better efficiency. The state vector must be
   * updated when persistDoc is called. Otherwise, we pull the ydoc and compute the state vector.
   *
   * @param {string} room
   * @param {string} docname
   * @param {Object} [opts]
   * @param {boolean} [opts.gc]
   * @param {string} [opts.branch]
   * @return {Promise<Uint8Array|null>}
   */
  async retrieveStateVector (room, docname, opts) {
    const r = await this.retrieveDoc(room, docname, opts)
    return r ? Y.encodeStateVectorFromUpdateV2(r.doc) : null
  }

  /**
   * @param {string} _room
   * @param {string} _docname
   * @param {Array<any>} _storeReferences
   * @param {Object} [_opts]
   * @param {boolean} [_opts.gc]
   * @param {string} [_opts.branch]
   * @return {Promise<void>}
   */
  deleteReferences (_room, _docname, _storeReferences, _opts) {
    err.methodUnimplemented()
  }

  async destroy () {
  }
}
