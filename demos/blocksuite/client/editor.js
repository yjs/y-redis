import '@toeverything/theme/style.css'

import { AffineSchemas } from '@blocksuite/blocks'
import { AffineEditorContainer } from '@blocksuite/presets'
// eslint-disable-next-line no-unused-vars
import { Schema, DocCollection, Text, Doc } from '@blocksuite/store'

const schema = new Schema().register(AffineSchemas)
export const collection = new DocCollection({ schema })
export const editor = new AffineEditorContainer()

/** @param {{onDocUpdated: function}} editorCallbacks */
export function initEditor (editorCallbacks) {
  editor.doc = collection.createDoc() // empty placeholder doc
  document.body.append(editor)

  collection.slots.docUpdated.on(() => editorCallbacks.onDocUpdated())
}

/** @param {string} id */
export function createDoc (id) {
  const doc = collection.createDoc({ id })

  doc.load(() => {
    const pageBlockId = doc.addBlock('affine:page')
    doc.addBlock('affine:surface', {}, pageBlockId)
    const noteId = doc.addBlock('affine:note', {}, pageBlockId)
    doc.addBlock(
      'affine:paragraph',
      { text: new Text('Hello World!') },
      noteId
    )
  })

  editor.doc = doc
}
