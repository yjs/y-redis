import '@toeverything/theme/style.css'

import { AffineSchemas } from '@blocksuite/blocks'
import { AffineEditorContainer } from '@blocksuite/presets'
import { Schema, DocCollection, Text } from '@blocksuite/store'

const schema = new Schema().register(AffineSchemas)
const collection = new DocCollection({ schema })
const doc = collection.createDoc()
const editor = new AffineEditorContainer()
editor.doc = doc
document.body.append(editor)

export function createDoc () {
  doc.load(() => {
    const pageBlockId = doc.addBlock('affine:page', {
      title: new Text('Test')
    })
    doc.addBlock('affine:surface', {}, pageBlockId)
    const noteId = doc.addBlock('affine:note', {}, pageBlockId)
    doc.addBlock(
      'affine:paragraph',
      { text: new Text('Hello World!') },
      noteId
    )
  })
}

const createBtn = document.getElementById('create-doc')
if (createBtn) createBtn.onclick = () => createDoc()
