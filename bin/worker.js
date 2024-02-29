#!/usr/bin/env node

import * as env from 'lib0/environment'
import * as api from '../src/api.js'

const postgresUrl = env.getConf('postgres')
const redisPrefix = env.getConf('redis-prefix') || 'y'

let storage
if (postgresUrl) {
  const { createPostgresStorage } = await import('../src/storage/postgres.js')
  storage = await createPostgresStorage()
} else {
  const { createMemoryStorage } = await import('../src/storage/memory.js')
  storage = createMemoryStorage()
}

api.createWorker(storage, redisPrefix)
