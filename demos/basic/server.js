#!/usr/bin/env node

import * as uws from 'uws'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import * as logging from 'lib0/logging'
import * as error from 'lib0/error'
import * as fs from 'fs'
import { registerYWebsocketServer } from '../../src/ws.js'

const port = number.parseInt(env.getConf('port') || '3001')
const postgresUrl = env.getConf('postgres')

let storage
if (postgresUrl) {
  const { createPostgresStorage } = await import('../../src/storage/postgres.js')
  storage = await createPostgresStorage()
} else {
  const { createMemoryStorage } = await import('../../src/storage/memory.js')
  storage = createMemoryStorage()
}

const app = uws.App({})

await registerYWebsocketServer(app, '/ws/*', storage, async (_req) => {})

// Serve a demo app consisting of only two files.
// There are better ways to do this in practice!
const indexFile = fs.readFileSync('../../demo/index.html')
const codemirrorFile = fs.readFileSync('../../dist/demo.js')

app.get('/', res => {
  res.end(indexFile)
})

app.any('/*', (res) => {
  res.end(codemirrorFile)
})

app.listen(port, (token) => {
  if (token) {
    logging.print(logging.GREEN, 'Listening to port ', port)
  } else {
    error.create('Failed to lisen to port ' + port)
  }
})
