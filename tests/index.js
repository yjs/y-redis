/* eslint-env node */
import { authServerStarted } from '../bin/auth-server-example.js'; // starts the example server

import { runTests } from 'lib0/testing';
import * as auth from './auth.tests.js';
import * as io_redis_api from './io-redis/api.tests.js';
import * as io_redis_ws from './io-redis/ws.tests.js';
import * as node_redis_api from './node-redis/api.tests.js';
import * as node_redis_ws from './node-redis/ws.tests.js';
import * as storage from './storage.tests.js';

await authServerStarted

await runTests({
  auth,
  io_redis_api,
  node_redis_api,
  io_redis_ws,
  node_redis_ws,
  storage,
}).then(success => {
  process.exit(success ? 0 : 1)
})
