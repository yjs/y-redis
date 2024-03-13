#!/usr/bin/env node

import * as number from 'lib0/number'
import * as env from 'lib0/environment'
import * as server from '../src/server.js'

const port = number.parseInt(env.getConf('port') || '3002')
const postgresUrl = env.getConf('postgres')
const checkPermCallbackUrl = env.ensureConf('AUTH_PERM_CALLBACK')

let store
if (postgresUrl) {
  const { createPostgresStorage } = await import('../src/storage/postgres.js')
  store = await createPostgresStorage()
} else {
  const { createMemoryStorage } = await import('../src/storage/memory.js')
  store = createMemoryStorage()
}

server.createYWebsocketServer({ port, store, checkPermCallbackUrl })
