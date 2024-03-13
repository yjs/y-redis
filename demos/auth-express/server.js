import express from 'express'
import * as jwt from 'lib0/crypto/jwt'
import * as time from 'lib0/time'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as env from 'lib0/environment'

const app = express()
const port = 4444

// Read the AUTH_PRIVATE_KEY environment variable and import the JWK
export const authPrivateKey = await ecdsa.importKeyJwk(JSON.parse(env.ensureConf('auth-private-key')))
// Read the AUTH_PUBLIC_KEY environment variable and import the JWK
export const authPublicKey = await ecdsa.importKeyJwk(JSON.parse(env.ensureConf('auth-public-key')))

const appName = 'my-express-app'

// This example server always grants read-write permission to all requests.
// Modify it to your own needs or implement the same API in your own backend!
app.get('/auth/token', async (_req, res) => {
  const token = await jwt.encodeJwt(authPrivateKey, {
    iss: appName,
    exp: time.getUnixTime() + 1000 * 60 * 60, // access expires in an hour
    yuserid: 'user1'
  })
  res.send(token)
})

// This api is called to check whether a specific user (identified by the unique "yuserid") has
// access to a specific room. This api is called by the yredis server, not the client.
app.get('/auth/perm/:room/:userid', async (req, res) => {
  const yroom = req.params.room
  const yuserid = req.params.userid
  // This sample-server always grants full acess
  res.send(JSON.stringify({
    yroom,
    yaccess: 'rw', // alternatively, specify "read-only" or "no-access"
    yuserid
  }))
})

// serve static files
app.use(express.static('./'))

app.listen(port, () => {
  console.log(`Express Demo Auth server listening on port ${port}`)
})
