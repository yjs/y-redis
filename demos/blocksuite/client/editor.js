import '@toeverything/theme/style.css'

import { AffineSchemas } from '@blocksuite/blocks'
import { AffineEditorContainer } from '@blocksuite/presets'
// eslint-disable-next-line no-unused-vars
import { Schema, DocCollection, Text, Doc, Slot } from '@blocksuite/store'

const schema = new Schema().register(AffineSchemas)
export const collection = new DocCollection({ schema })
export const editor = new AffineEditorContainer()
export const emptyDoc = collection.createDoc() // empty placeholder

export function initEditor () {
  editor.doc = emptyDoc
  document.body.append(editor)

  return {
    onDocUpdated: collection.slots.docUpdated
  }
}

/** @param {string} id */
export function loadDoc (id) {
  const localDoc = collection.getDoc(id)
  if (localDoc) return localDoc

  return collection.createDoc({ id })
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
}
