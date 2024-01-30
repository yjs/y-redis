# y-redis :elephant:
> Redis persistence layer for [Yjs](https://github.com/yjs/yjs)

![work in progress](https://cdn.pixabay.com/photo/2014/11/04/13/20/lego-516557_960_720.jpg)

## Example

```js
const { RedisPersistence } = require('y-redis')

// redis configuration information
const redisConfig = {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB,
  keyPrefix: process.env.REDIS_KEY_PREFIIX,
}

const rp = new RedisPersistence({ redisOpts: redisConfig })
const persistence = {
  provider: rp,
  bindState: async (docName, ydoc) => {
    rp.closeDoc(docName)
    return rp.bindState(docName, ydoc)
  },
  writeState: async (docName, ydoc) => {},
}
```
