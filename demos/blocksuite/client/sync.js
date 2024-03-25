// eslint-disable-next-line no-unused-vars
import { Doc } from '@blocksuite/store'
import { WebsocketProvider } from 'y-websocket'
import { authToken } from './api.js'
import { getCurrentRoom } from './route.js'
import { editor } from './editor.js'

const endpoint = 'ws://localhost:3002'

/** @type {WebsocketProvider | null} */
let currentProvider = null
/** @type {Doc | null} */
let currentDoc = null

/** @param {Doc} doc */
export function sync (doc) {
  if (doc === currentDoc) return
  if (currentProvider) currentProvider.destroy()

  const room = getCurrentRoom()
  const params = { yauth: authToken }
  const provider = new WebsocketProvider(endpoint, room, doc.spaceDoc, { params })
  provider.on('sync', () => {
    doc.load()
    editor.doc = doc
  })
  currentProvider = provider
  currentDoc = doc
}
