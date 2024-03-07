#!/usr/bin/env node

import * as uws from 'uws'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'
import * as logging from 'lib0/logging'
import * as error from 'lib0/error'
import * as fs from 'fs'
import * as jwt from 'lib0/crypto/jwt'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as json from 'lib0/json'
import { registerYWebsocketServer } from '../../src/ws.js'
import * as time from 'lib0/time'
import * as array from 'lib0/array'

const GITHUB_CLIENT_ID = env.ensureConf('github-client-id')
const GITHUB_CLIENT_SECRET = env.ensureConf('github-client-secret')
const wsServerPublicKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('wsserver-public')))
const wsServerPrivateKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('wsserver-private')))

const port = number.parseInt(env.getConf('port') || '3002')
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

// The client can requests a jwt from the server, which will verify that it has access to the
// "collaborative room".
app.get('/auth/:room', async (res, req) => {
  const yroom = req.getParameter(0)
  let aborted = false
  res.onAborted(() => {
    aborted = true
  })
  const token = await jwt.encodeJwt(wsServerPrivateKey, {
    iss: 'my-auth-server',
    exp: time.getUnixTime() + 1000 * 60 * 60 * 24, // access expires in a day
    yroom,
    yaccess: 'rw', // set to either 'rw' or 'readonly'
    yuserid: 'user1' // fill this with a unique id of the authorized user
  })
  if (aborted) return
  res.cork(() => {
    res.end(token)
  })
})

await registerYWebsocketServer(app, '/ws/:room', storage, async (req) => {
  const room = req.getParameter(0)
  const token = req.getQuery('yauth')
  if (token == null) {
    throw new Error('Missing Token')
  }
  const { payload } = await jwt.verifyJwt(wsServerPublicKey, token)
  if (payload.yroom !== room) {
    throw new Error('No access to requested room')
  }
  if (payload.yaccess !== 'readonly' && payload.yaccess !== 'rw') {
    throw new Error('No access type specified "yaccess"')
  }
  return { hasWriteAccess: payload.yaccess === 'rw', room }
})

// Serve a demo app consisting of only two files.
// There are better ways to do this in practice!
const indexFile = fs.readFileSync('./demo.html')
const jsFile = fs.readFileSync('./dist/demo.js')

app.get('/', res => {
  res.end(indexFile)
})

app.any('/*', (res) => {
  res.cork(() => {
    res.writeHeader('Content-Type', 'application/javascript')
    res.end(jsFile)
  })
})

app.listen(port, (token) => {
  if (token) {
    logging.print(logging.GREEN, 'Listening to port ', port)
  } else {
    error.create('Failed to lisen to port ' + port)
  }
})
