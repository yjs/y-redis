const endpoint = `http://${window.location.host}`

async function getDocMetaList () {
  const response = await fetch(`${endpoint}/docs`)
  /** @type {{id: string, title: string}[]} */
  const docList = await response.json()
  return docList
}

async function addDocMeta () {
  const response = await fetch(`${endpoint}/docs`, {
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
  await fetch(`${endpoint}/docs/${id}/title`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title })
  })
}

/** @param {string} id */
async function deleteDocMeta (id) {
  await fetch(`${endpoint}/docs/${id}`, {
    method: 'DELETE'
  })
}

async function getAuthToken () {
  const response = await fetch(`${endpoint}/auth/token`)
  return response.text()
}

export const authToken = await getAuthToken()

export const api = {
  getDocMetaList,
  addDocMeta,
  updateDocMeta,
  deleteDocMeta
}
