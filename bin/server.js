#!/usr/bin/env node

import { MemoryStorage } from '../src/storage.js'
import { createYWebsocketServer } from '../src/ws.js'
import * as env from 'lib0/environment'
import * as number from 'lib0/number'

const port = number.parseInt(env.getConf('port') || '8080')

createYWebsocketServer(port, 'localhost', new MemoryStorage())
