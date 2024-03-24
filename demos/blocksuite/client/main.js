import { initEditor } from './editor.js'
import { getCurrentRoom } from './route.js'
import { initUI, resetDocList } from './ui.js'

window.addEventListener('load', () => {
  const room = getCurrentRoom()
  const editorSlots = initEditor()
  initUI(editorSlots)
  resetDocList(room)
})
