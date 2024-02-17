import * as Y from 'yjs'
import * as t from 'lib0/testing'
import * as api from '../src/api.js'
import * as promise from 'lib0/promise'
import { WebSocket } from 'ws'
import * as ws from '../src/ws.js'
import * as array from 'lib0/array'
import { WebsocketProvider } from 'y-websocket'
import * as redis from 'redis'
import { prevClients, store } from './utils.js'

const port = 3000
const wsUrl = `ws://localhost:${port}`

/**
 * @param {t.TestCase} tc
 * @param {string} room
 */
const createWsClient = (tc, room) => {
  const ydoc = new Y.Doc()
  const roomPrefix = tc.testName
  const provider = new WebsocketProvider(wsUrl, roomPrefix + '-' + room, ydoc, { WebSocketPolyfill: /** @type {any} */ (WebSocket), disableBc: true })
  return { ydoc, provider }
}

const createWorker = async () => {
  const worker = await api.createWorker(store)
  worker.client.redisMinMessageLifetime = 200
  worker.client.redisWorkerTimeout = 50
  prevClients.push(worker.client)
  return worker
}

const createServer = async () => {
  const server = await ws.createYWebsocketServer(port, store)
  prevClients.push(server)
  return server
}

const createApiClient = async () => {
  const client = await api.createApiClient(store)
  prevClients.push(client)
  return client
}

/**
 * @param {t.TestCase} tc
 */
const createTestCase = async tc => {
  await promise.all(prevClients.map(c => c.destroy()))
  prevClients.length = 0
  const redisClient = redis.createClient({ url: api.redisUrl })
  await redisClient.connect()
  await redisClient.flushAll()
  prevClients.push({ destroy: () => redisClient.quit().then(() => {}) })
  const [apiClient, server, worker] = await promise.all([createApiClient(), createServer(), createWorker()])
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
const waitDocsSynced = (ydoc1, ydoc2) =>
  promise.until(0, () => {
    const e1 = Y.encodeStateAsUpdateV2(ydoc1)
    const e2 = Y.encodeStateAsUpdateV2(ydoc2)
    return array.equalFlat(e1, e2)
  })

/**
 * @param {t.TestCase} tc
 */
export const testSyncAndCleanup = async tc => {
  const { createWsClient, worker, redisClient } = await createTestCase(tc)
  const { ydoc: doc1 } = createWsClient('map')
  // doc2: can retrieve changes propagated on stream
  const { ydoc: doc2 } = createWsClient('map')
  doc1.getMap().set('a', 1)
  await waitDocsSynced(doc1, doc2)
  const docStreamExistsBefore = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + '-' + 'map', 'index'))
  t.assert(doc2.getMap().get('a') === 1)
  // doc3 can retrieve older changes from stream
  const { ydoc: doc3 } = createWsClient('map')
  await waitDocsSynced(doc1, doc3)
  t.assert(doc3.getMap().get('a') === 1)
  await promise.wait(worker.client.redisMinMessageLifetime * 2)
  const docStreamExists = await redisClient.exists(api.computeRedisRoomStreamName(tc.testName + '-' + 'map', 'index'))
  const workerLen = await redisClient.xLen('y:worker')
  t.assert(!docStreamExists && docStreamExistsBefore)
  t.assert(workerLen === 0)
  // doc4 can retrieve the document again from MemoryStore
  const { ydoc: doc4 } = createWsClient('map')
  await waitDocsSynced(doc3, doc4)
  t.assert(doc3.getMap().get('a') === 1)
  const memRetrieved = await store.retrieveDoc(tc.testName + '-' + 'map', 'index')
  t.assert(memRetrieved?.references.length === 1)
  // now write another updates that the worker will collect
  doc1.getMap().set('a', 2)
  await promise.wait(worker.client.redisMinMessageLifetime * 2)
  t.assert(doc2.getMap().get('a') === 2)
  const memRetrieved2 = await store.retrieveDoc(tc.testName + '-' + 'map', 'index')
  // should delete old references
  t.assert(memRetrieved2?.references.length === 1)
}
