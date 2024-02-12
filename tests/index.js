/* eslint-env node */

import * as api from './api.tests.js'
import * as ws from './ws.tests.js'
import { runTests } from 'lib0/testing'

runTests({
  api,
  ws
}).then(success => {
  process.exit(success ? 0 : 1)
})
