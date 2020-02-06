
import * as Y from 'yjs'
import { RedisPersistence } from '../src/y-redis.js'
import * as t from 'lib0/testing.js'
import * as promise from 'lib0/promise.js'
import Redis from 'ioredis'

/**
 * Two clients concurrently adding content
 *
 * @param {t.TestCase} tc
 */
export const testPubsub = async tc => {
  const redis = new Redis()
  await redis.flushall()

  const redisPersistence1 = new RedisPersistence()
  const doc1 = new Y.Doc()
  const persistedDoc1 = redisPersistence1.bindState('test', doc1)
  await persistedDoc1.synced

  const redisPersistence2 = new RedisPersistence()
  const doc2 = new Y.Doc()
  const persistedDoc2 = redisPersistence2.bindState('test', doc2)
  await persistedDoc2.synced

  doc1.getArray('test').push([1])
  doc2.getArray('test').push([2])

  await promise.until(0, () => persistedDoc1._clock > 1)

  t.assert(doc1.getArray('test').length === 2)
  t.assert(doc2.getArray('test').length === 2)

  redisPersistence1.destroy()
  redisPersistence2.destroy()
}

/**
 * @param {t.TestCase} tc
 */
export const testStoreAndReload = async tc => {
  const redis = new Redis()
  await redis.flushall()
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    redisPersistence.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    t.assert(doc.getArray('test').length === 1)
    redisPersistence.destroy()
  }
}

/**
 * @param {t.TestCase} tc
 */
export const testClearDocument = async tc => {
  const redis = new Redis()
  await redis.flushall()
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    await redisPersistence.clearDocument('test')
    redisPersistence.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    t.assert(doc.getArray('test').length === 0)
    redisPersistence.destroy()
  }
}

/**
 * @param {t.TestCase} tc
 */
export const testClearAllDocument = async tc => {
  const redis = new Redis()
  await redis.flushall()
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    await redisPersistence.clearAllDocuments()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState('test', doc).synced
    t.assert(doc.getArray('test').length === 0)
    redisPersistence.destroy()
  }
}

/**
 * @param {t.TestCase} tc
 */
export const testPerformance = async tc => {
  const redis = new Redis()
  await redis.flushall()
  const N = 10000
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    const persistenceDoc = redisPersistence.bindState('test', doc)
    await persistenceDoc.synced
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray = doc.getArray('test')
      for (let i = 0; i < N; i++) {
        testarray.insert(0, [i])
      }
      await promise.until(0, () => persistenceDoc._clock >= N)
      t.assert(testarray.length === N)
      return undefined
    })
    await t.measureTime('destroy persistence with pending pubsub messages', async () => {
      await redisPersistence.destroy()
      return undefined
    })
  }
  {
    const redisPersistence = new RedisPersistence()
    await t.measureTime(`read ${N / 1000}k updates`, async () => {
      const doc = new Y.Doc()
      await redisPersistence.bindState('test', doc).synced
      t.assert(doc.getArray('test').length === N)
      return undefined
    })
    await redisPersistence.destroy()
  }
}
