const serverUrl = `http://${window.location.host}`

async function getDocMetaList () {
  const response = await fetch(`${serverUrl}/docs`)
  /** @type {{id: string, title: string}[]} */
  const docList = await response.json()
  return docList
}

async function addDocMeta () {
  const response = await fetch(`${serverUrl}/docs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  /** @type {{id: string, title: string}} */
  const docMeta = await response.json()
  return docMeta
}

/** @param {string} id @param {string} title */
async function updateDocMeta (id, title) {
  await fetch(`${serverUrl}/docs/${id}/title`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title })
  })
}

/** @param {string} id */
async function deleteDocMeta (id) {
  await fetch(`${serverUrl}/docs/${id}`, {
    method: 'DELETE'
  })
}

export const api = {
  getDocMetaList,
  addDocMeta,
  updateDocMeta,
  deleteDocMeta
}
