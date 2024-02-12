import * as Y from 'yjs'
import * as t from 'lib0/testing'
import * as api from '../src/api.js'
import * as storage from '../src/storage.js'
import * as promise from 'lib0/promise'
import { WebSocket } from 'ws'
import * as ws from '../src/ws.js'
import * as array from 'lib0/array'
import { WebsocketProvider } from 'y-websocket'

const port = 3000
const redisUrl = 'redis://localhost:6379'
const wsUrl = `ws://localhost:${port}`

/**
 * @type {Array<{ destroy: function():void }>}
 */
const prevClients = []
const store = new storage.MemoryStorage()

/**
 * @param {t.TestCase} tc
 * @param {string} room
 */
const createWsClient = (tc, room) => {
  const ydoc = new Y.Doc()
  const roomPrefix = tc.testName
  const provider = new WebsocketProvider(wsUrl, roomPrefix + '-' + room, ydoc, { WebSocketPolyfill: WebSocket, disableBc: true })
  return { ydoc, provider }
}

const createWorker = async () => {
  const worker = await api.createWorker(redisUrl, store)
  worker.client.redisMinMessageLifetime = 200
  worker.client.redisWorkerTimeout = 50
  prevClients.push(worker.client)
  return worker
}

const createServer = async () => {
  const server = await ws.createYWebsocketServer(port, redisUrl, store)
  prevClients.push(server)
  return server
}

const createApiClient = async () => {
  const client = await api.createApiClient(redisUrl, store)
  prevClients.push(client)
  return client
}

/**
 * @param {t.TestCase} tc
 */
const createTestCase = async tc => {
  await promise.all(prevClients.map(c => c.destroy()))
  prevClients.length = 0
  const apiClient = await createApiClient()
  await apiClient.redis.flushAll()
  const [server, worker] = await promise.all([createServer(), createWorker()])
  return {
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
export const testUpdateApiMessages = async tc => {
  const { createWsClient } = await createTestCase(tc)
  const { ydoc: doc1 } = createWsClient('map')
  const { ydoc: doc2 } = createWsClient('map')
  doc1.getMap().set('a', 1)
  await waitDocsSynced(doc1, doc2)
  t.assert(doc2.getMap().get('a') === 1)
  const { ydoc: doc3 } = createWsClient('map')
  await waitDocsSynced(doc1, doc3)
  t.assert(doc3.getMap().get('a') === 1)
}
