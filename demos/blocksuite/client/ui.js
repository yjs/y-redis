import { api } from './api.js'
import { createDoc } from './editor.js'

/** @type HTMLSelectElement */ // @ts-ignore
const docSelect = document.getElementById('doc-list')
const addDocBtn = document.getElementById('add-doc')
const deleteDocBtn = document.getElementById('delete-doc')

export async function resetDocList () {
  const docList = await api.getDocMetaList()

  if (docList.length > 0) {
    docSelect.innerHTML = ''
    docList.forEach((doc) => {
      const option = document.createElement('option')
      option.value = doc.id
      option.textContent = doc.title || 'Untitled'
      docSelect.appendChild(option)
    })
  } else {
    docSelect.innerHTML = '<option value="" disabled selected hidden>No Docs</option>'
  }
}

async function addDoc () {
  const { id } = await api.addDocMeta()
  createDoc(id)
  resetDocList()
}

async function deleteDoc () {
  const currentDocId = docSelect.value
  if (!currentDocId) return
  await api.deleteDocMeta(currentDocId)
  resetDocList()
}

function onDocUpdated () {
  console.log('doc updated') // @todo update list title
}

export function initUI () {
  addDocBtn && addDocBtn.addEventListener('click', addDoc)
  deleteDocBtn && deleteDocBtn.addEventListener('click', deleteDoc)
  return { onDocUpdated }
}
