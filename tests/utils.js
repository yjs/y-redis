import * as env from 'lib0/environment'
import * as json from 'lib0/json'
import * as ecdsa from 'lib0/crypto/ecdsa'

import { createMemoryStorage } from '../src/storage/memory.js'

/**
 * @type {Array<{ destroy: function():Promise<void>}>}
 */
export const prevClients = []
export const store = createMemoryStorage()

export const authPrivateKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-private-key')))
export const authPublicKey = await ecdsa.importKeyJwk(json.parse(env.ensureConf('auth-public-key')))

export const redisPrefix = 'ytests'

export const authDemoServerPort = 5173
export const authDemoServerUrl = `http://localhost:${authDemoServerPort}`
export const checkPermCallbackUrl = `${authDemoServerUrl}/auth/perm/`
export const authTokenUrl = `${authDemoServerUrl}/auth/token`

export const yredisPort = 9999
export const yredisUrl = `ws://localhost:${yredisPort}/`
