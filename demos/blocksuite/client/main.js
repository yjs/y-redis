import { initEditor, loadDoc } from './editor.js'
import { getCurrentRoom } from './route.js'
import { sync } from './sync.js'
import { initUI, resetDocList } from './ui.js'

const room = getCurrentRoom()
const editorSlots = initEditor()
const doc = loadDoc(room)

initUI(editorSlots)
resetDocList(room)
if (room) sync(doc)
