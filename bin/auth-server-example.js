import * as uws from 'uws'
import * as jwt from 'lib0/crypto/jwt'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as json from 'lib0/json'
import * as time from 'lib0/time'
import * as env from 'lib0/environment'
import * as logging from 'lib0/logging'
import * as error from 'lib0/error'
import * as promise from 'lib0/promise'
import * as encoding from 'lib0/encoding'
import * as Y from 'yjs'

const appName = 'Auth-Server-Example'
const authPrivateKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-private-key')))
const port = 5173

console.log('Auth Server Config', { port })

const app = uws.App({})

app.put('/ydoc/:room', async function updated(res, req) {
  let aborted = false
  res.onAborted(() => {
    aborted = true
  })
  const room = req.getParameter(0)
  const header = req.getHeader('content-type')
  // this "encoder" will accumulate the received data until all data arrived
  const contentEncoder = encoding.createEncoder()
  res.onData((chunk, isLast) => {
    encoding.writeUint8Array(contentEncoder, new Uint8Array(chunk))
    if (isLast && !aborted) {
      const fullContent = encoding.toUint8Array(contentEncoder)
      const parts = uws.getParts(fullContent, header)
      const ydocUpdateData = parts?.find(part => part.name === 'ydoc')?.data
      if (ydocUpdateData == null) {
        console.error('Received empty data')
        return
      }
      const ydocUpdate = new Uint8Array(ydocUpdateData)
      Y.logUpdateV2(ydocUpdate)
      const ydoc = new Y.Doc()
      Y.applyUpdateV2(ydoc, ydocUpdate)
      console.log('/ydoc', { room, content: dumpDoc(ydoc) })
      res.endWithoutBody()
    }
  })
})

// This example server always grants read-write permission to all requests.
// Modify it to your own needs or implement the same API in your own backend!
app.get('/auth/token', async function authn(res, _req) {
  const yuserid = 'user1'
  let aborted = false
  res.onAborted(() => {
    aborted = true
  })
  const token = await jwt.encodeJwt(authPrivateKey, {
    iss: appName,
    exp: time.getUnixTime() + 1000 * 60 * 60, // access expires in an hour
    yuserid
  })
  if (aborted) return
  res.cork(() => res.end(token))
  console.log('/auth/token', { yuserid }, '=>', token)
})

app.get('/auth/perm/:room/:userid', async function authz(res, req) {
  const yroom = req.getParameter(0)
  const yuserid = req.getParameter(1)
  const response = json.stringify({ yroom, yaccess: 'rw', yuserid })
  console.log('/auth/perm', { yroom, yuserid }, '=>', response)
  res.end(response)
})

/**
 * Resolves when the server started.
 */
export const whenStarted = promise.create((resolve, reject) => {
  const server = app.listen(port, (token) => {
    if (token) {
      console.log(`Listening on port ${port}`)
      resolve()
    } else {
      const err = error.create(`[${appName}] Failed to listen on port ${port}`)
      reject(err)
      throw err
    }
  })

  // Gracefully shut down the server when running in Docker
  process.on('SIGTERM', shutDown)
  process.on('SIGINT', shutDown)

  function shutDown() {
    console.log('Received SIGTERM/SIGINT - shutting down')
    server.close()
    process.exit(0)
  }
})

/**
 * Hacky function to dump latest version of a general Y.Doc to a plain object.
 * Ideally you would assume a specific schema and use the approprate typed getter.
 *
 * @param {Y.Doc} ydoc
 */
function dumpDoc(ydoc) {
  /**
   * @type {Object<string, any>}
   */
  const doc = {}
  ydoc.share.forEach((type, key) => {
    // Hack to "get" types in order for yDoc.toJSON() to show the data.
    let value =
      type._start !== null //
        ? ydoc.getText(key).toJSON()
        : type._map.size !== 0
        ? ydoc.getMap(key).toJSON()
        : 'unknown'

    doc[key] = value
  })
  return doc
}
