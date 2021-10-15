
import * as Y from 'yjs'
import { RedisPersistence } from '../src/y-redis.js'
import * as t from 'lib0/testing'
import * as promise from 'lib0/promise'
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
  const persistedDoc1 = redisPersistence1.bindState(tc.testName, doc1)
  await persistedDoc1.synced

  const redisPersistence2 = new RedisPersistence()
  const doc2 = new Y.Doc()
  const persistedDoc2 = redisPersistence2.bindState(tc.testName, doc2)
  await persistedDoc2.synced

  doc1.getArray('test').push([1])
  doc2.getArray('test').push([2])

  await promise.until(0, () => persistedDoc1._clock > 1)

  t.assert(doc1.getArray('test').length === 2)
  t.assert(doc2.getArray('test').length === 2)

  await redisPersistence1.destroy()
  await redisPersistence2.destroy()
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
    await redisPersistence.bindState(tc.testName, doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    redisPersistence.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState(tc.testName, doc).synced
    t.assert(doc.getArray('test').length === 1)
    await redisPersistence.destroy()
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
    await redisPersistence.bindState(tc.testName, doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    await redisPersistence.clearDocument(tc.testName)
    await redisPersistence.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState(tc.testName, doc).synced
    t.assert(doc.getArray('test').length === 0)
    await redisPersistence.destroy()
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
    await redisPersistence.bindState(tc.testName, doc).synced
    doc.getArray('test').push([1])
    await promise.wait(50)
    await redisPersistence.clearAllDocuments()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    await redisPersistence.bindState(tc.testName, doc).synced
    t.assert(doc.getArray('test').length === 0)
    await redisPersistence.destroy()
  }
}

/**
 * Test time until N updates are written to redis + time to receive and apply updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformance = async tc => {
  const redis = new Redis()
  await redis.flushall()
  const N = 10000
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc)
    await persistenceDoc.synced
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray = doc.getArray('test')
      for (let i = 0; i < N; i++) {
        testarray.insert(0, [i])
      }
      await promise.until(0, () => persistenceDoc._clock >= N)
      t.assert(testarray.length === N)
      t.assert(persistenceDoc._clock === N)
      return undefined
    })
    await redisPersistence.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc)
    await t.measureTime(`read ${N / 1000}k updates`, async () => {
      await persistenceDoc.synced
      t.assert(doc.getArray('test').length === N)
      return undefined
    })
    await redisPersistence.destroy()
  }
}

/**
 * Two clients concurrently adding a lot of updates. Syncing after every 10 updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformanceConcurrent = async tc => {
  const redis = new Redis()
  await redis.flushall()
  const N = 100
  {
    const redisPersistence1 = new RedisPersistence()
    const doc1 = new Y.Doc()
    const persistenceDoc1 = redisPersistence1.bindState(tc.testName, doc1)
    await persistenceDoc1.synced
    const redisPersistence2 = new RedisPersistence()
    const doc2 = new Y.Doc()
    const persistenceDoc2 = redisPersistence2.bindState(tc.testName, doc2)
    await persistenceDoc2.synced
    await t.measureTimeAsync(`write ${N / 1000}k updates`, async () => {
      const testarray1 = doc1.getArray('test')
      const testarray2 = doc2.getArray('test')
      for (let i = 0; i < N; i++) {
        if (i % 2) {
          testarray1.insert(0, [i])
        } else {
          testarray2.insert(0, [i])
        }
        if (i % 10 === 0) {
          await promise.until(0, () => persistenceDoc1._clock > i && persistenceDoc2._clock >= i)
          t.assert(persistenceDoc1._clock === i + 1)
          t.assert(persistenceDoc2._clock === i + 1)
        }
      }
      await promise.until(0, () => persistenceDoc1._clock >= N && persistenceDoc2._clock >= N)
      t.assert(testarray1.length === N)
      t.assert(testarray2.length === N)
      t.assert(persistenceDoc1._clock === N)
      t.assert(persistenceDoc2._clock === N)
      return undefined
    })
    await redisPersistence1.destroy()
  }
  {
    const redisPersistence = new RedisPersistence()
    const doc = new Y.Doc()
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc)

    await t.measureTime(`read ${N / 1000}k updates`, async () => {
      await persistenceDoc.synced
      t.assert(doc.getArray('test').length === N)
      return undefined
    })
    await redisPersistence.destroy()
  }
  const updateslen = await redis.llen(`${tc.testName}:updates`)
  t.assert(updateslen === N)
}

/**
 * Test the time until another client received all updates.
 *
 * @param {t.TestCase} tc
 */
export const testPerformanceReceive = async tc => {
  const redis = new Redis()
  await redis.flushall()
  const N = 10000
  {
    const redisPersistence1 = new RedisPersistence()
    const doc1 = new Y.Doc()
    const persistenceDoc1 = redisPersistence1.bindState(tc.testName, doc1)
    await persistenceDoc1.synced
    const redisPersistence2 = new RedisPersistence()
    const doc2 = new Y.Doc()
    const persistenceDoc2 = redisPersistence2.bindState(tc.testName, doc2)
    await persistenceDoc2.synced
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray1 = doc1.getArray('test')
      const testarray2 = doc1.getArray('test')
      for (let i = 0; i < N; i++) {
        testarray1.insert(0, [i])
      }
      await promise.until(0, () => persistenceDoc1._clock >= N && persistenceDoc2._clock >= N)
      t.assert(testarray1.length === N)
      t.assert(testarray2.length === N)
      t.assert(persistenceDoc1._clock === N)
      t.assert(persistenceDoc2._clock === N)
      return undefined
    })
    await redisPersistence1.destroy()
  }
  await t.measureTime(`read ${N / 1000}k updates`, async () => {
    const doc = new Y.Doc()
    const redisPersistence = new RedisPersistence()
    await redisPersistence.bindState(tc.testName, doc).synced
    t.assert(doc.getArray('test').length === N)
    redisPersistence.destroy()
    return undefined
  })
  const updateslen = await redis.llen(`${tc.testName}:updates`)
  t.assert(updateslen === N)
}
