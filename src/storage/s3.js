import * as Y from 'yjs'
import * as random from 'lib0/random'
import * as promise from 'lib0/promise'
import * as minio from 'minio'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import * as logging from 'lib0/logging'

const log = logging.createModuleLogger('@y/redis/s3')

/**
 * @typedef {import('../storage.js').AbstractStorage} AbstractStorage
 */

/**
 * @todo perform some sanity checks here before starting (bucket exists, ..)
 * @param {string} bucketName
 */
export const createS3Storage = (bucketName) => {
  const endPoint = env.ensureConf('s3-endpoint')
  const port = number.parseInt(env.ensureConf('s3-port'))
  const useSSL = !['false', '0'].includes(env.getConf('s3-ssl') || 'false')
  const accessKey = env.ensureConf('s3-access-key')
  const secretKey = env.ensureConf('s3-secret-key')
  return new S3Storage(bucketName, {
    endPoint,
    port,
    useSSL,
    accessKey,
    secretKey
  })
}

/**
 * @param {string} room
 * @param {string} docid
 */
export const encodeS3ObjectName = (room, docid, r = random.uuidv4()) => `${encodeURIComponent(room)}/${encodeURIComponent(docid)}/${r}`

/**
 * @param {string} objectName
 */
export const decodeS3ObjectName = objectName => {
  const match = objectName.match(/(.*)\/(.*)\/(.*)$/)
  if (match == null) {
    throw new Error('Malformed y:room stream name!')
  }
  return { room: decodeURIComponent(match[1]), docid: decodeURIComponent(match[2]), r: match[3] }
}

/**
 * @typedef {Object} S3StorageConf
 * @property {string} S3StorageConf.endPoint
 * @property {number} S3StorageConf.port
 * @property {boolean} S3StorageConf.useSSL
 * @property {string} S3StorageConf.accessKey
 * @property {string} S3StorageConf.secretKey
 */

/**
 * @param {import('stream').Stream} stream
 * @return {Promise<Buffer>}
 */
const readStream = stream => promise.create((resolve, reject) => {
  /**
   * @type {Array<Buffer>}
   */
  const chunks = []
  stream.on('data', chunk => chunks.push(Buffer.from(chunk)))
  stream.on('error', reject)
  stream.on('end', () => resolve(Buffer.concat(chunks)))
})

/**
 * @implements {AbstractStorage}
 */
export class S3Storage {
  /**
   * @param {string} bucketName
   * @param {S3StorageConf} conf
   */
  constructor (bucketName, { endPoint, port, useSSL, accessKey, secretKey }) {
    this.bucketName = bucketName
    this.client = new minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey
    })
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @param {Y.Doc} ydoc
   * @returns {Promise<void>}
   */
  async persistDoc (room, docname, ydoc) {
    const objectName = encodeS3ObjectName(room, docname)
    await this.client.putObject(this.bucketName, objectName, Buffer.from(Y.encodeStateAsUpdateV2(ydoc)))
  }

  /**
   * @param {string} room
   * @param {string} docname
   * @return {Promise<{ doc: Uint8Array, references: Array<string> } | null>}
   */
  async retrieveDoc (room, docname) {
    log('retrieving doc room=' + room + ' docname=' + docname)
    const objNames = await this.client.listObjectsV2(this.bucketName, encodeS3ObjectName(room, docname, ''), true).toArray()
    const references = objNames.map(obj => obj.name)
    log('retrieved doc room=' + room + ' docname=' + docname + ' refs=' + JSON.stringify(references))

    if (references.length === 0) {
      return null
    }
    let updates = await promise.all(references.map(ref => this.client.getObject(this.bucketName, ref).then(readStream)))
    updates = updates.filter(update => update != null)
    log('retrieved doc room=' + room + ' docname=' + docname + ' updatesLen=' + updates.length)
    return { doc: Y.mergeUpdatesV2(updates), references }
  }

  /**
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
   * @param {Array<string>} storeReferences
   * @return {Promise<void>}
   */
  async deleteReferences (_room, _docname, storeReferences) {
    await this.client.removeObjects(this.bucketName, storeReferences)
  }

  async destroy () {
  }
}
