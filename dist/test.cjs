'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var Y = require('yjs');
var mutex = require('lib0/dist/mutex.cjs');
var observable_js = require('lib0/dist/observable.cjs');
var promise = require('lib0/dist/promise.cjs');
var error = require('lib0/dist/error.cjs');
var logging = require('lib0/dist/logging.cjs');
var Redis = _interopDefault(require('ioredis'));
var t = require('lib0/dist/testing.cjs');
var environment_js = require('lib0/dist/environment.cjs');

const logger = logging.createModuleLogger('y-redis');

/**
 * Handles persistence of a sinle doc.
 */
class PersistenceDoc {
  /**
   * @param {RedisPersistence} rp
   * @param {string} name
   * @param {Y.Doc} doc
   */
  constructor (rp, name, doc) {
    this.rp = rp;
    this.name = name;
    this.doc = doc;
    this.mux = mutex.createMutex();
    /**
     * Next expected index / len of the list of updates
     * @type {number}
     */
    this._clock = 0;
    this._fetchingClock = 0;
    /**
     * @param {Uint8Array} update
     */
    this.updateHandler = update => {
      // mux: only store update in redis if this document update does not originate from redis
      this.mux(() => {
        rp.redis.rpushBuffer(name + ':updates', Buffer.from(update)).then(len => {
          if (len === this._clock + 1) {
            this._clock++;
            if (this._fetchingClock < this._clock) {
              this._fetchingClock = this._clock;
            }
          }
          // @ts-ignore
          rp.redis.publish(this.name, len.toString());
        });
      });
    };
    if (doc.store.clients.size > 0) {
      this.updateHandler(Y.encodeStateAsUpdate(doc));
    }
    doc.on('update', this.updateHandler);
    this.synced = rp.sub.subscribe(name).then(() => this.getUpdates());
  }

  /**
   * @return {Promise<any>}
   */
  destroy () {
    this.doc.off('update', this.updateHandler);
    this.rp.docs.delete(this.name);
    return this.rp.sub.unsubscribe(this.name)
  }

  /**
   * Get all new updates from redis and increase clock if necessary.
   *
   * @return {Promise<PersistenceDoc>}
   */
  getUpdates () {
    const startClock = this._clock;
    return this.rp.redis.lrangeBuffer(this.name + ':updates', startClock, -1).then(/** @type {function(Array<Buffer>)} */ updates => {
      logger('Fetched ', logging.BOLD, logging.PURPLE, (updates.length).toString().padEnd(2), logging.UNBOLD, logging.UNCOLOR, ' updates');
      this.mux(() => {
        this.doc.transact(() => {
          updates.forEach(update => {
            Y.applyUpdate(this.doc, update);
          });
          const nextClock = startClock + updates.length;
          if (this._clock < nextClock) {
            this._clock = nextClock;
          }
          if (this._fetchingClock < this._clock) {
            this._fetchingClock = this._clock;
          }
        });
      });
      if (this._fetchingClock <= this._clock) {
        return this
      } else {
        // there is still something missing. new updates came in. fetch again.
        if (updates.length === 0) {
          // Calling getUpdates recursively has the potential to be an infinite fetch-call.
          // In case no new updates came in, reset _fetching clock (in case the pubsub lied / send an invalid message).
          // Being overly protective here..
          this._fetchingClock = this._clock;
        }
        return this.getUpdates()
      }
    })
  }
}

/**
 * @param {Object|null} redisOpts
 * @param {Array<Object>|null} redisClusterOpts
 * @return {Redis.Redis | Redis.Cluster}
 */
const createRedisInstance = (redisOpts, redisClusterOpts) => redisClusterOpts
  ? new Redis.Cluster(redisClusterOpts)
  : (redisOpts ? new Redis(redisOpts) : new Redis());

/**
 * @extends Observable<string>
 */
class RedisPersistence extends observable_js.Observable {
  /**
   * @param {Object} [opts]
   * @param {Object|null} [opts.redisOpts]
   * @param {Array<Object>|null} [opts.redisClusterOpts]
   */
  constructor ({ redisOpts = /** @type {any} */ (null), redisClusterOpts = /** @type {any} */ (null) } = {}) {
    super();
    this.redis = createRedisInstance(redisOpts, redisClusterOpts);
    this.sub = /** @type {Redis.Redis} */ (createRedisInstance(redisOpts, redisClusterOpts));
    /**
     * @type {Map<string,PersistenceDoc>}
     */
    this.docs = new Map();
    this.sub.on('message', (channel, sclock) => {
      // console.log('message', channel, sclock)
      const pdoc = this.docs.get(channel);
      if (pdoc) {
        const clock = Number(sclock) || Number.POSITIVE_INFINITY; // case of null
        if (pdoc._fetchingClock < clock) {
          // do not query doc updates if this document is currently already fetching
          const isCurrentlyFetching = pdoc._fetchingClock !== pdoc._clock;
          if (pdoc._fetchingClock < clock) {
            pdoc._fetchingClock = clock;
          }
          if (!isCurrentlyFetching) {
            pdoc.getUpdates();
          }
        }
      } else {
        this.sub.unsubscribe(channel);
      }
    });
  }

  /**
   * @param {string} name
   * @param {Y.Doc} ydoc
   * @return {PersistenceDoc}
   */
  bindState (name, ydoc) {
    if (this.docs.has(name)) {
      throw error.create(`"${name}" is already bound to this RedisPersistence instance`)
    }
    const pd = new PersistenceDoc(this, name, ydoc);
    this.docs.set(name, pd);
    return pd
  }

  destroy () {
    const docs = this.docs;
    this.docs = new Map();
    return promise.all(Array.from(docs.values()).map(doc => doc.destroy())).then(() => {
      this.redis.quit();
      this.sub.quit();
      // @ts-ignore
      this.redis = null;
      // @ts-ignore
      this.sub = null;
    })
  }

  /**
   * @param {string} name
   */
  closeDoc (name) {
    const doc = this.docs.get(name);
    if (doc) {
      return doc.destroy()
    }
  }

  /**
   * @param {string} name
   * @return {Promise<any>}
   */
  clearDocument (name) {
    const doc = this.docs.get(name);
    if (doc) {
      doc.destroy();
    }
    return this.redis.del(name + ':updates')
  }

  /**
   * Destroys this instance and removes all known documents from the database.
   * After that this Persistence instance is destroyed.
   *
   * @return {Promise<any>}
   */
  clearAllDocuments () {
    return promise.all(Array.from(this.docs.keys()).map(name => this.redis.del(name + ':updates'))).then(() => {
      this.destroy();
    })
  }
}

/**
 * Two clients concurrently adding content
 *
 * @param {t.TestCase} tc
 */
const testPubsub = async tc => {
  const redis = new Redis();
  await redis.flushall();

  const redisPersistence1 = new RedisPersistence();
  const doc1 = new Y.Doc();
  const persistedDoc1 = redisPersistence1.bindState(tc.testName, doc1);
  await persistedDoc1.synced;

  const redisPersistence2 = new RedisPersistence();
  const doc2 = new Y.Doc();
  const persistedDoc2 = redisPersistence2.bindState(tc.testName, doc2);
  await persistedDoc2.synced;

  doc1.getArray('test').push([1]);
  doc2.getArray('test').push([2]);

  await promise.until(0, () => persistedDoc1._clock > 1);

  t.assert(doc1.getArray('test').length === 2);
  t.assert(doc2.getArray('test').length === 2);

  await redisPersistence1.destroy();
  await redisPersistence2.destroy();
};

/**
 * @param {t.TestCase} tc
 */
const testStoreAndReload = async tc => {
  const redis = new Redis();
  await redis.flushall();
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    doc.getArray('test').push([1]);
    await promise.wait(50);
    redisPersistence.destroy();
  }
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    t.assert(doc.getArray('test').length === 1);
    await redisPersistence.destroy();
  }
};

/**
 * @param {t.TestCase} tc
 */
const testClearDocument = async tc => {
  const redis = new Redis();
  await redis.flushall();
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    doc.getArray('test').push([1]);
    await promise.wait(50);
    await redisPersistence.clearDocument(tc.testName);
    await redisPersistence.destroy();
  }
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    t.assert(doc.getArray('test').length === 0);
    await redisPersistence.destroy();
  }
};

/**
 * @param {t.TestCase} tc
 */
const testClearAllDocument = async tc => {
  const redis = new Redis();
  await redis.flushall();
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    doc.getArray('test').push([1]);
    await promise.wait(50);
    await redisPersistence.clearAllDocuments();
  }
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    await redisPersistence.bindState(tc.testName, doc).synced;
    t.assert(doc.getArray('test').length === 0);
    await redisPersistence.destroy();
  }
};

/**
 * Test time until N updates are written to redis + time to receive and apply updates.
 *
 * @param {t.TestCase} tc
 */
const testPerformance = async tc => {
  const redis = new Redis();
  await redis.flushall();
  const N = 10000;
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc);
    await persistenceDoc.synced;
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray = doc.getArray('test');
      for (let i = 0; i < N; i++) {
        testarray.insert(0, [i]);
      }
      await promise.until(0, () => persistenceDoc._clock >= N);
      t.assert(testarray.length === N);
      t.assert(persistenceDoc._clock === N);
      return undefined
    });
    await redisPersistence.destroy();
  }
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc);
    await t.measureTime(`read ${N / 1000}k updates`, async () => {
      await persistenceDoc.synced;
      t.assert(doc.getArray('test').length === N);
      return undefined
    });
    await redisPersistence.destroy();
  }
};

/**
 * Two clients concurrently adding a lot of updates. Syncing after every 10 updates.
 *
 * @param {t.TestCase} tc
 */
const testPerformanceConcurrent = async tc => {
  const redis = new Redis();
  await redis.flushall();
  const N = 100;
  {
    const redisPersistence1 = new RedisPersistence();
    const doc1 = new Y.Doc();
    const persistenceDoc1 = redisPersistence1.bindState(tc.testName, doc1);
    await persistenceDoc1.synced;
    const redisPersistence2 = new RedisPersistence();
    const doc2 = new Y.Doc();
    const persistenceDoc2 = redisPersistence2.bindState(tc.testName, doc2);
    await persistenceDoc2.synced;
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray1 = doc1.getArray('test');
      const testarray2 = doc2.getArray('test');
      for (let i = 0; i < N; i++) {
        if (i % 2) {
          testarray1.insert(0, [i]);
        } else {
          testarray2.insert(0, [i]);
        }
        if (i % 10 === 0) {
          await promise.until(0, () => persistenceDoc1._clock > i && persistenceDoc2._clock >= i);
          t.assert(persistenceDoc1._clock === i + 1);
          t.assert(persistenceDoc2._clock === i + 1);
        }
      }
      await promise.until(0, () => persistenceDoc1._clock >= N && persistenceDoc2._clock >= N);
      t.assert(testarray1.length === N);
      t.assert(testarray2.length === N);
      t.assert(persistenceDoc1._clock === N);
      t.assert(persistenceDoc2._clock === N);
      return undefined
    });
    await redisPersistence1.destroy();
  }
  {
    const redisPersistence = new RedisPersistence();
    const doc = new Y.Doc();
    const persistenceDoc = redisPersistence.bindState(tc.testName, doc);

    await t.measureTime(`read ${N / 1000}k updates`, async () => {
      await persistenceDoc.synced;
      t.assert(doc.getArray('test').length === N);
      return undefined
    });
    await redisPersistence.destroy();
  }
  const updateslen = await redis.llen(`${tc.testName}:updates`);
  t.assert(updateslen === N);
};

/**
 * Test the time until another client received all updates.
 *
 * @param {t.TestCase} tc
 */
const testPerformanceReceive = async tc => {
  const redis = new Redis();
  await redis.flushall();
  const N = 10000;
  {
    const redisPersistence1 = new RedisPersistence();
    const doc1 = new Y.Doc();
    const persistenceDoc1 = redisPersistence1.bindState(tc.testName, doc1);
    await persistenceDoc1.synced;
    const redisPersistence2 = new RedisPersistence();
    const doc2 = new Y.Doc();
    const persistenceDoc2 = redisPersistence2.bindState(tc.testName, doc2);
    await persistenceDoc2.synced;
    await t.measureTime(`write ${N / 1000}k updates`, async () => {
      const testarray1 = doc1.getArray('test');
      const testarray2 = doc1.getArray('test');
      for (let i = 0; i < N; i++) {
        testarray1.insert(0, [i]);
      }
      await promise.until(0, () => persistenceDoc1._clock >= N && persistenceDoc2._clock >= N);
      t.assert(testarray1.length === N);
      t.assert(testarray2.length === N);
      t.assert(persistenceDoc1._clock === N);
      t.assert(persistenceDoc2._clock === N);
      return undefined
    });
    await redisPersistence1.destroy();
  }
  await t.measureTime(`read ${N / 1000}k updates`, async () => {
    const doc = new Y.Doc();
    const redisPersistence = new RedisPersistence();
    await redisPersistence.bindState(tc.testName, doc).synced;
    t.assert(doc.getArray('test').length === N);
    redisPersistence.destroy();
    return undefined
  });
  const updateslen = await redis.llen(`${tc.testName}:updates`);
  t.assert(updateslen === N);
};

var redis = /*#__PURE__*/Object.freeze({
  __proto__: null,
  testPubsub: testPubsub,
  testStoreAndReload: testStoreAndReload,
  testClearDocument: testClearDocument,
  testClearAllDocument: testClearAllDocument,
  testPerformance: testPerformance,
  testPerformanceConcurrent: testPerformanceConcurrent,
  testPerformanceReceive: testPerformanceReceive
});

if (environment_js.isBrowser) {
  logging.createVConsole(document.body);
}
t.runTests({
  redis
}).then(success => {
  /* istanbul ignore next */
  if (environment_js.isNode) {
    process.exit(success ? 0 : 1);
  }
});
//# sourceMappingURL=test.cjs.map
