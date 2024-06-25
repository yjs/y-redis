#!/usr/bin/env node

import * as env from 'lib0/environment'
import * as yredis from '@y/redis'
import * as Y from 'yjs'

const redisPrefix = env.getConf('redis-prefix') || 'y'
const postgresUrl = env.getConf('postgres')
const s3Endpoint = env.getConf('s3-endpoint')

let store
if (s3Endpoint) {
  console.log('using s3 store')
  const { createS3Storage } = await import('../src/storage/s3.js')
  const bucketName = 'ydocs'
  store = createS3Storage(bucketName)
  try {
    // make sure the bucket exists
    await store.client.makeBucket(bucketName)
  } catch (e) {}
} else if (postgresUrl) {
  console.log('using postgres store')
  const { createPostgresStorage } = await import('../src/storage/postgres.js')
  store = await createPostgresStorage()
} else {
  console.log('ATTENTION! using in-memory store')
  const { createMemoryStorage } = await import('../src/storage/memory.js')
  store = createMemoryStorage()
}

let ydocUpdateCallback = env.getConf('ydoc-update-callback')
if (ydocUpdateCallback != null && ydocUpdateCallback.slice(-1) !== '/') {
  ydocUpdateCallback += '/'
}

/**
 * @type {(room: string, ydoc: Y.Doc) => Promise<void>}
 */
const updateCallback = async (room, ydoc) => {
  if (ydocUpdateCallback != null) {
    // call YDOC_UPDATE_CALLBACK here
    const formData = new FormData()
    // @todo only convert ydoc to updatev2 once
    formData.append('ydoc', new Blob([Y.encodeStateAsUpdateV2(ydoc)]))
    // @todo should add a timeout to fetch (see fetch signal abortcontroller)
    const res = await fetch(new URL(room, ydocUpdateCallback), { body: formData, method: 'PUT' })
    if (!res.ok) {
      console.error(`Issue sending data to YDOC_UPDATE_CALLBACK. status="${res.status}" statusText="${res.statusText}"`)
    }
  }
}

yredis.createWorker(store, redisPrefix, {
  updateCallback
})
