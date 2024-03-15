/* eslint-env browser */

import * as Y from 'yjs'
// @ts-ignore
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { WebsocketProvider } from 'y-websocket'

import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'

import * as random from 'lib0/random'
import { EditorState } from '@codemirror/state'

export const usercolors = [
  { color: '#30bced', light: '#30bced33' },
  { color: '#6eeb83', light: '#6eeb8333' },
  { color: '#ffbc42', light: '#ffbc4233' },
  { color: '#ecd444', light: '#ecd44433' },
  { color: '#ee6352', light: '#ee635233' },
  { color: '#9ac2c9', light: '#9ac2c933' },
  { color: '#8acb88', light: '#8acb8833' },
  { color: '#1be7ff', light: '#1be7ff33' }
]

export const userColor = usercolors[random.uint32() % usercolors.length]

const room = 'y-redis-demo-app'
const authTokenRequest = await fetch(`http://${location.host}/auth/token`)
const authToken = await authTokenRequest.text()

const ydoc = new Y.Doc()
const provider = new WebsocketProvider('ws://localhost:3002', room, ydoc, { params: { yauth: authToken } })
const ytext = ydoc.getText('codemirror')

provider.awareness.setLocalStateField('user', {
  name: 'Anonymous ' + Math.floor(Math.random() * 100),
  color: userColor.color,
  colorLight: userColor.light
})

const state = EditorState.create({
  doc: ytext.toString(),
  extensions: [
    keymap.of([
      ...yUndoManagerKeymap
    ]),
    basicSetup,
    javascript(),
    EditorView.lineWrapping,
    yCollab(ytext, provider.awareness)
    // oneDark
  ]
})

const view = new EditorView({ state, parent: /** @type {HTMLElement} */ (document.querySelector('#editor')) })

// @ts-ignore
window.example = { provider, ydoc, ytext, view }
