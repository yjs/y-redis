import { createMemoryStorage } from '../src/storage/memory.js'

/**
 * @type {Array<{ destroy: function():Promise<void>}>}
 */
export const prevClients = []
export const store = createMemoryStorage()
