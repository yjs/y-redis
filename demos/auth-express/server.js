import * as Y from 'yjs'
import express from 'express'
import formidable from 'formidable'
import * as jwt from 'lib0/crypto/jwt'
import * as time from 'lib0/time'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as env from 'lib0/environment'
import * as fs from 'fs/promises'
import * as promise from 'lib0/promise'

const app = express()
const port = 5173

// Read the AUTH_PRIVATE_KEY environment variable and import the JWK
export const authPrivateKey = await ecdsa.importKeyJwk(JSON.parse(env.ensureConf('auth-private-key')))
// Read the AUTH_PUBLIC_KEY environment variable and import the JWK
export const authPublicKey = await ecdsa.importKeyJwk(JSON.parse(env.ensureConf('auth-public-key')))

const appName = 'my-express-app'

console.log(appName, 'Config', { port })

// This endpoint is called in regular intervals when the document changes.
// The request contains a multi-part formdata field that can be read, for example, with formidable:
app.put('/ydoc/:room', async (req, res, next) => {
  const room = req.params.room
  const ydocUpdate = await promise.create((resolve, reject) => {
    const form = formidable({})
    form.parse(req, (err, _fields, files) => {
      if (err) {
        next(err)
        reject(err)
        return
      }
      if (files.ydoc) {
        // formidable writes the data to a file by default. This might be a good idea for your
        // application. Check the documentation to find a non-temporary location for the read file.
        // You should probably delete it if it is no longer being used.
        const file = files.ydoc[0]
        // we are just going to log the content and delete the temporary file
        fs.readFile(file.filepath).then(resolve, reject)
      }
    })
  })
  const ydoc = new Y.Doc()
  Y.applyUpdateV2(ydoc, ydocUpdate)
  console.log(`/ydoc`, { room, content: ydoc.getText('codemirror').toString().replaceAll('\n', '\\n') })
  res.sendStatus(200)
})

// This example server always grants read-write permission to all requests.
// Modify it to your own needs or implement the same API in your own backend!
app.get('/auth/token', async (_req, res) => {
  const yuserid = 'user1'
  const token = await jwt.encodeJwt(authPrivateKey, {
    iss: appName,
    exp: time.getUnixTime() + 1000 * 60 * 60, // access expires in an hour
    yuserid // associate the client with a unique id that can will be used to check permissions
  })
  res.send(token)
  console.log('/auth/token', { yuserid }, '=>', token)
})

// This api is called to check whether a specific user (identified by the unique "yuserid") has
// access to a specific room. This rest endpoint is called by the yredis server, not the client.
app.get('/auth/perm/:room/:userid', async (req, res) => {
  const yroom = req.params.room
  const yuserid = req.params.userid
  // This sample-server always grants full acess
  // alternatively, specify "read-only" or "no-access"
  const response = JSON.stringify({ yroom, yaccess: 'rw', yuserid })
  console.log('/auth/perm', { yroom, yuserid }, '=>', response)
  res.send(response)
})

// serve static files
app.use(express.static('./'))

const server = app.listen(port, () => {
  console.log(`Listening on port ${port}`)
})

// Gracefully shut down the server when running in Docker
process.on('SIGTERM', shutDown)
process.on('SIGINT', shutDown)

function shutDown() {
  console.log('Received SIGTERM/SIGINT - shutting down')
  server.closeAllConnections()
  process.exit(0)
}
