import { initEditor } from './editor.js'
import { initUI, resetDocList } from './ui.js'

window.addEventListener('load', () => {
  const editorSlots = initEditor()
  initUI(editorSlots)
  resetDocList()
})
