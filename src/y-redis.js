
/*
 * TODO:
 *  * When applying an update (connector.receiveMessage) you must make sure that the update is not sent back to redis!
 *    - only computational overhead currently
 *    - this will be possible when applying an operation is synchronous
 *
 */

const PREFERRED_TRIM_SIZE = 300

const redisInstances = new Map()

// messages , message, room
let saveMessageCommandSha = null
const saveMessageCommand = `
-- [[ messages , message, room ]]
redis.call("RPUSH", KEYS[1], ARGV[1])
redis.call("PUBLISH", ARGV[2], ARGV[1])
`

// messageCounter messages yjsModel , newCount yjsModel
let saveYjsModelSha = null
const saveYjsModel = `
-- [[ messageCounter messages yjsModel , newCount yjsModel ]]
local cnt = 0
if (redis.call("EXISTS", KEYS[1]) == 1) then
  cnt = tonumber(redis.call("GET", KEYS[1]))
end
local del = tonumber(ARGV[1]) - cnt
if del > 0 then
  redis.call("SET", KEYS[3], ARGV[2])
  redis.call("SET", KEYS[1], ARGV[1])
  redis.call("LTRIM", KEYS[2], del, -1)
end
`

function registerScripts (redis) {
  return Promise.all([
    new Promise((resolve, reject) => {
      redis.send_command('SCRIPT', ['LOAD', saveMessageCommand], function (err, sha) {
        if (err != null) {
          reject(err)
        } else {
          saveMessageCommandSha = sha
          resolve()
        }
      })
    }),
    new Promise((resolve, reject) => {
      redis.send_command('SCRIPT', ['LOAD', saveYjsModel], function (err, sha) {
        if (err != null) {
          reject(err)
        } else {
          saveYjsModelSha = sha
          resolve()
        }
      })
    })
  ])
}

function registerPersistenceToPubSub (persistence) {
  let redis = persistence.redis
  if (!redisInstances.has(redis)) {
    let pubsub = redis.duplicate()
    let rooms = new Map()
    redis.on('end', function () {
      console.log('Ended Redis connection')
      persistence.y.destroy()
      pubsub.quit()
    })
    pubsub.on('end', function () {
      // one cannot exist without the other..
      console.log('Ended PubSub connection')
      redis.quit()
    })
    redisInstances.set(redis, {
      rooms: rooms,
      pubsub: pubsub,
      scriptsRegistered: registerScripts(redis)
    })
    pubsub.on('subscribe', function (room) {
      room = room.toString()
      let persistence = rooms.get(room)
      persistence.log('Room %s: Subscribed PubSub', room)
      persistence._subscribeDefer()
    })
    pubsub.on('unsubscribe', function (room) {
      room = room.toString()
      let persistence = rooms.get(room)
      persistence.log('Room %s: Unsubscribed PubSub', room)
      persistence._unsubscribeDefer()
      rooms.delete(room)
    })
    pubsub.on('message', function (room, message) {
      rooms.get(room.toString()).receiveMessageFromRedis(message)
    })
    pubsub.psubscribe('*')
  }
  let rooms = redisInstances.get(redis).rooms
  let pubsub = redisInstances.get(redis).pubsub
  let scriptsRegistered = redisInstances.get(redis).scriptsRegistered
  let room = persistence.y.options.connector.room
  rooms.set(room, persistence)
  pubsub.subscribe(room)
  return Promise.all([persistence.subscribedPromise, scriptsRegistered])
}

function unregisterPersitenceFromPubSub (persistence) {
  let pubsub = redisInstances.get(persistence.redis).pubsub
  let room = persistence.y.options.connector.room
  pubsub.unsubscribe(room)
  // room is deleted from rooms in "unsubscribed" event
  return persistence.unsubscribedPromise
}

function extendRedisPersistence (Y) {
  class RedisPersistence extends Y.AbstractPersistence {
    constructor (y, opts) {
      super(y, opts)
      this.subscribedPromise = new Promise(resolve => { this._subscribeDefer = resolve })
      this.unsubscribedPromise = new Promise(resolve => { this._unsubscribeDefer = resolve })
      // saves the amount of stored messages before calling persistDB
      this.saveMessageCounter = 0
      this.persistingDatabase = false
      // The initial content has been retrieved from the database
      this.computedInitialContent = false
      this.bufferedMessagesBeforeInitialContent = []
      this.redis = opts.redis
      this.redisPubSub = opts.redisPubSub
      this.sendMessagesToRedis = true
    }

    blockSendToRedis (f) {
      let tmp = this.sendMessagesToRedis
      this.sendMessagesToRedis = false
      f()
      this.sendMessagesToRedis = tmp
    }
    destroy () {
      return this.persistDB().then(() => {
        clearInterval(this.updateIntervalHandler)
        return unregisterPersitenceFromPubSub(this)
      }).then(() => {
        this.redis = null
        this.opts = null
      })
    }

    receiveMessageFromRedis (message) {
      if (this.computedInitialContent) {
        this.blockSendToRedis(() => {
          this.mcount++
          this.y.connector.receiveMessage('redis', message, true)
        })
      } else {
        this.bufferedMessagesBeforeInitialContent.push(message)
      }
    }

    saveToMessageQueue (message) {
      let room = this.y.options.connector.room
      this.redis.send_command('EVALSHA', [saveMessageCommandSha, 1, room + ':messages', Buffer.from(message), room])
      this.saveMessageCounter++
      super.saveToMessageQueue(message)
      if (this.saveMessageCounter >= PREFERRED_TRIM_SIZE) {
        this.persistDB()
      }
    }

    saveOperations (ops) {
      if (this.sendMessagesToRedis) {
        super.saveOperations(ops)
      }
    }

    retrieveContent () {
      return registerPersistenceToPubSub(this).then(() => new Promise((resolve, reject) => {
        let room = this.y.options.connector.room
        this.redis.multi()
          .get(room + ':model')
          .lrange(room + ':messages', 0, -1)
          .get(room + ':mcount')
          .exec((err, [model, messages, mcount]) => {
            if (err != null) {
              reject(err)
              return
            }
            messages = messages || []
            this.log('Room %s: Retrieved database content. mcount: %s, messages: %s', room, mcount, messages.length)
            if (model != null) {
              this.y.db.requestTransaction(function * () {
                yield * this.fromBinary(model)
              })
            }
            this.mcount = mcount || 0

            let missingMessages = this.bufferedMessagesBeforeInitialContent.filter(bm => !messages.some(m => Buffer.compare(bm, m)))
            messages = messages.concat(missingMessages)
            this.bufferedMessagesBeforeInitialContent = null
            this.blockSendToRedis(() => {
              messages.forEach(m => {
                this.y.connector.receiveMessage('redis', m, true)
                this.mcount++
              })
            })
            this.computedInitialContent = true
            let msize = messages.length
            this.y.db.whenTransactionsFinished().then(() => {
              if (msize >= PREFERRED_TRIM_SIZE) {
                this.persistDB()
              }
              resolve()
            })
          })
      }))
    }

    persistDB () {
      if (!this.computedInitialContent) {
        return Promise.reject(new Error('Unable to persistDB(). The content is not yet initialized via retrieveContent!'))
      }
      this.log('Room %s: Persisting Yjs model to Redis', this.y.options.connector.room)
      this.saveMessageCounter = 0
      return new Promise((resolve) => {
        this.y.db.requestTransaction(function * () {
          let buffer = yield * this.toBinary()
          resolve(Buffer.from(buffer))
        })
      }).then(buffer => new Promise((resolve, reject) => {
        let room = this.y.options.connector.room
        this.redis.send_command('EVALSHA', [saveYjsModelSha, 3, room + ':mcount', room + ':messages', room + ':model', this.mcount, buffer], (err, res) => {
          if (err != null) {
            reject(err)
          } else {
            resolve()
          }
        })
      }))
    }
  }
  Y.extend('redis', RedisPersistence)
}

module.exports = extendRedisPersistence
