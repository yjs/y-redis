import * as t from 'lib0/testing'
import * as utils from './utils.js'
import * as jwt from 'lib0/crypto/jwt'
import * as json from 'lib0/json'

import { authServerStarted } from '../bin/auth-server-example.js' // starts the example server

/**
 * @param {t.TestCase} _tc
 */
export const testSampleAuthServer = async _tc => {
  await authServerStarted
  const room = 'sample-room'
  const token = await fetch(utils.authTokenUrl).then(req => req.text())
  // verify that the user has a valid token
  const { payload: userToken } = await jwt.verifyJwt(utils.authPublicKey, token)
  console.log('server created', { userToken })
  if (userToken.yuserid == null) {
    throw new Error('Missing userid in user token!')
  }
  const perm = await fetch(new URL(`${room}/${userToken.yuserid}`, utils.checkPermCallbackUrl)).then(req => req.json())
  t.info('retrieved permission: ' + json.stringify(perm))
  t.assert(perm.yroom === room)
  t.assert(perm.yaccess === 'rw')
  t.assert(perm.yuserid != null)
}
