export function getCurrentRoom () {
  return window.location.pathname.replace(/^\//, '')
}

/** @param {string} id */
export function setRoom (id) {
  if (getCurrentRoom() === id) return
  const newPath = `/${encodeURIComponent(id)}`
  window.history.pushState({ path: newPath }, '', newPath)
}
