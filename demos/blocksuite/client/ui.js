// eslint-disable-next-line no-unused-vars
import { Slot } from '@blocksuite/store'
import { api } from './api.js'
import { collection, createDoc, editor, emptyDoc } from './editor.js'

/** @type HTMLSelectElement */ // @ts-ignore
const docListElement = document.getElementById('doc-list')
const addDocBtn = document.getElementById('add-doc')
const deleteDocBtn = document.getElementById('delete-doc')

export async function resetDocList () {
  const docList = await api.getDocMetaList()

  if (docList.length > 0) {
    docListElement.innerHTML = ''
    docList.forEach((doc) => {
      const option = document.createElement('option')
      option.value = doc.id
      option.textContent = doc.title || 'Untitled'
      docListElement.appendChild(option)
    })
  } else {
    docListElement.innerHTML = '<option value="" disabled selected hidden>No Docs</option>'
  }
}

/** @param {string} id @param {string} title */
function updateDocList (id, title) {
  const option = docListElement.querySelector(`option[value="${id}"]`)
  if (!option) return
  option.textContent = title
}

async function addDoc () {
  const { id } = await api.addDocMeta()
  createDoc(id)
  await resetDocList()
  docListElement.selectedIndex = Array.from(docListElement.options).findIndex(o => o.value === id)
  switchDoc()
}

async function deleteDoc () {
  const currentDocId = docListElement.value
  if (!currentDocId) return
  await api.deleteDocMeta(currentDocId)
  await resetDocList()
  docListElement.selectedIndex = 0
  switchDoc()
}

async function updateDocTitle () {
  const currentDocId = docListElement.value
  if (!currentDocId) return
  const title = collection.getDoc(currentDocId)?.meta?.title ?? ''
  await api.updateDocMeta(currentDocId, title)
  updateDocList(currentDocId, title)
}

function switchDoc () {
  const currentDocId = docListElement.value
  let doc = collection.getDoc(currentDocId)
  if (!doc) doc = emptyDoc
  editor.doc = doc
}

/** @param {{onDocUpdated: Slot<void>}} editorSlots */
export function initUI (editorSlots) {
  addDocBtn && addDocBtn.addEventListener('click', addDoc)
  deleteDocBtn && deleteDocBtn.addEventListener('click', deleteDoc)
  docListElement.addEventListener('change', switchDoc)

  editorSlots.onDocUpdated.on(() => updateDocTitle())
}
