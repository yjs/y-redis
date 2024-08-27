import * as array from 'lib0/array'
import * as jwt from 'lib0/crypto/jwt'
import * as promise from 'lib0/promise'
import * as t from 'lib0/testing'
import * as time from 'lib0/time'
import { createClient } from 'redis'
import { WebSocket } from 'ws'
import { WebsocketProvider } from 'y-websocket'
import * as Y from 'yjs'
import * as api from '../../src/api.js'
import { createYWebsocketServer } from '../../src/server.js'
import { authPrivateKey, checkPermCallbackUrl, redisUrl, store, yredisPort, yredisUrl } from '../utils.js'

const redisPrefix = 'ytestsnoderedis'
/**
 * @type {Array<{ destroy: function():Promise<void>}>}
 */
const prevClients = []
const createRedisInstance = async () => {
  return createClient({ url: redisUrl }).connect()
}

const authToken = await jwt.encodeJwt(authPrivateKey, {
  iss: 'my-auth-server',
  exp: time.getUnixTime() + 60 * 60 * 1000, // token expires in one hour
  yuserid: 'user1' // fill this with a unique id of the authorized user
})

/**
 * @param {t.TestCase} tc
 * @param {string} room
 */
const createWsClient = (tc, room) => {
  const ydoc = new Y.Doc()
  const roomPrefix = tc.testName + "NODEREDIS"
  const provider = new WebsocketProvider(yredisUrl, roomPrefix + '-' + room, ydoc, { WebSocketPolyfill: /** @type {any} */ (WebSocket), disableBc: true, params: {}, protocols: [`yauth-${authToken}`] })
  return { ydoc, provider }
}

const createWorker = async () => {

  const worker = await api.createWorker(store, redisPrefix, {}, createRedisInstance)
  worker.client.redisMinMessageLifetime = 800
  worker.client.redisTaskDebounce = 500
  prevClients.push(worker.client)
  return worker
}

const createServer = async () => {
  const server = await createYWebsocketServer({ port: yredisPort, store: store, redisPrefix: redisPrefix, checkPermCallbackUrl: checkPermCallbackUrl, createRedisInstance })
  prevClients.push(server)
  return server
}
/**
 * 
 * @returns 
 */
const createApiClient = async () => {
  const client = await api.createApiClient(store, redisPrefix, createRedisInstance)
  prevClients.push(client)
  return client
}

/**
 * @param {t.TestCase} tc
 */
const createTestCase = async tc => {
  await promise.all(prevClients.map(c => c.destroy()))
  prevClients.length = 0
  const redisClient = createClient({ url: redisUrl })
  await redisClient.connect()
  // flush existing content
  const keysToDelete = await redisClient.keys(redisPrefix + ':*')
  await redisClient.del(keysToDelete)
  prevClients.push({ destroy: () => redisClient.quit().then(() => {}) })
  const server = await createServer()

  const [apiClient, worker] = await promise.all([createApiClient(), createWorker()])
  return {
    redisClient,
    apiClient,
    server,
    worker,
    createWsClient: /** @param {string} room */ (room) => createWsClient(tc, room)
  }
}

/**
 * @param {Y.Doc} ydoc1
 * @param {Y.Doc} ydoc2
 */
const waitDocsSynced = (ydoc1, ydoc2) => {
  console.info('waiting for docs to sync...')
  return promise.until(0, () => {
    const e1 = Y.encodeStateAsUpdateV2(ydoc1)
    const e2 = Y.encodeStateAsUpdateV2(ydoc2)
    const isSynced = array.equalFlat(e1, e2)
    isSynced && console.info('docs sycned!')
    return isSynced
  })
}

/**
 * @param {t.TestCase} tc
 */
export const testSyncAndCleanup = async tc => {
  const { createWsClient, worker, redisClient } = await createTestCase(tc)
  const { ydoc: doc1 } = createWsClient('map')
  // doc2: can retrieve changes propagated on stream
  const { ydoc: doc2 } = createWsClient('map')
  doc1.getMap().set('a', 1)
  t.info('docs syncing (0)')
  await waitDocsSynced(doc1, doc2)
  t.info('docs synced (1)')
  const docStreamExistsBefore = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + "NODEREDIS" + '-' + 'map', 'index', redisPrefix))
  t.assert(doc2.getMap().get('a') === 1)
  // doc3 can retrieve older changes from stream
  const { ydoc: doc3 } = createWsClient('map')
  await waitDocsSynced(doc1, doc3)
  t.info('docs synced (2)')
  t.assert(doc3.getMap().get('a') === 1)
  await promise.wait(worker.client.redisMinMessageLifetime * 5)
  const docStreamExists = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + "NODEREDIS" + '-' + 'map', 'index', redisPrefix))
  const workerLen = await redisClient.xLen(redisPrefix + ':worker')
  t.assert(!docStreamExists && docStreamExistsBefore)
  t.assert(workerLen === 0)
  t.info('stream cleanup after initial changes')
  // doc4 can retrieve the document again from MemoryStore
  const { ydoc: doc4 } = createWsClient('map')
  await waitDocsSynced(doc3, doc4)
  t.info('docs synced (3)')
  t.assert(doc3.getMap().get('a') === 1)
  const memRetrieved = await store.retrieveDoc(tc.testName + "NODEREDIS" + '-' + 'map', 'index')
  t.assert(memRetrieved?.references.length === 1)
  t.info('doc retrieved')
  // now write another updates that the worker will collect
  doc1.getMap().set('a', 2)
  await promise.wait(worker.client.redisMinMessageLifetime * 2)
  t.assert(doc2.getMap().get('a') === 2)
  const memRetrieved2 = await store.retrieveDoc(tc.testName + "NODEREDIS" + '-' + 'map', 'index')
  t.info('map retrieved')
  // should delete old references
  t.assert(memRetrieved2?.references.length === 1)
  await promise.all(prevClients.reverse().map(c => c.destroy()))
}
