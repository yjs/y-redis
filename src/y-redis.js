
/*
 * TODO: When applying an update (connector.receiveMessage) I have to make sure
 *       that the update is not sent back to redis
 */

/**
 * Save an update to redis
 */
let saveUpdateCommandSha = null
const saveUpdateCommand = `
-- [[ room:updates room:contentClock , update incrementContentClock ]]
redis.call("RPUSH", KEYS[1], ARGV[1])
if ARGV[2] == "true" then
  redis.call("INCR", KEYS[2])
end
-- redis.call("PUBLISH", ARGV[2], ARGV[1])
`

/**
 * Save the model to Redis.
 * * Deletes all known updates from the updates queue in redis
 * * increases counter based on local counter information
 */
let saveYjsModelSha = null
const saveYjsModel = `
-- [[ room:counter room:updates room:model room:extra, newCount yjsModel extra]]
local cnt = 0
if (redis.call("EXISTS", KEYS[1]) == 1) then
  cnt = tonumber(redis.call("GET", KEYS[1]))
end
local del = tonumber(ARGV[1]) - cnt
if del > 0 then
  redis.call("SET", KEYS[1], tonumber(ARGV[1]))
  redis.call("LTRIM", KEYS[2], del, -1)
  redis.call("SET", KEYS[3], ARGV[2])
  if (ARGV[3] ~= nil) then
    redis.call("SET", KEYS[4], ARGV[3])
  end
end
`

/**
 * Based on the given counter information, retrieve all missing updates.
 */
let getRemainingUpdatesSha = null
const getRemainingUpdates = `
-- [[ room:counter room:updates room:contentClock room:extra, count ]]
local count = tonumber(ARGV[1])
local contentClock = 0
if (redis.call("EXISTS", KEYS[1]) == 1) then
  count = count - tonumber(redis.call("GET", KEYS[1]))
end
if (redis.call("EXISTS", KEYS[3]) == 1) then
  contentClock = redis.call("GET", KEYS[3])
end
return { redis.call("LRANGE", KEYS[2], count, -1), contentClock, redis.call("GET", KEYS[4]) }
`

function registerScripts (redis) {
  return Promise.all([
    new Promise((resolve, reject) => {
      redis.send_command('SCRIPT', ['LOAD', saveUpdateCommand], function (err, sha) {
        if (err !== null) {
          reject(err)
        } else {
          saveUpdateCommandSha = sha
          resolve()
        }
      })
    }),
    new Promise((resolve, reject) => {
      redis.send_command('SCRIPT', ['LOAD', saveYjsModel], function (err, sha) {
        if (err !== null) {
          reject(err)
        } else {
          saveYjsModelSha = sha
          resolve()
        }
      })
    }),
    new Promise((resolve, reject) => {
      redis.send_command('SCRIPT', ['LOAD', getRemainingUpdates], function (err, sha) {
        if (err !== null) {
          reject(err)
        } else {
          getRemainingUpdatesSha = sha
          resolve()
        }
      })
    })
  ])
}

const redis = require('redis')

function extendRedisPersistence (Y) {
  /**
   * YRedis Persistence
   * This Persistence Object can handle multiple Yjs instances.
   */
  class YRedisPersistence extends Y.AbstractPersistence {
    /**
     * contentCheck is a function that checks if the content changed
     * If contentCheck is defined, room:contentClock will be increased when new
     * content is persisted to the database and contentCheck returns true
     */
    constructor (redisURL, contentCheck) {
      super()
      this.contentCheck = contentCheck || function () { return false }
      this.redisClient = redis.createClient(redisURL, {
        return_buffers: true
      })
      registerScripts(this.redisClient)
    }

    /**
     * Initialize the data that belongs to a Yjs instance.
     */
    init (y) {
      let state = this.ys.get(y)
      state.counter = 0
      state.contentClock = 0
    }

    /**
     * Remove all data that belongs to a Yjs instance.
     */
    deinit (y) {
      super.deinit(y)
    }

    /**
     * Disconnect from the Redis Store.
     * Need to be called to that the program can exit.
     */
    destroy () {
      super.destroy()
      this.redisClient.unref()
    }

    incrementContentClock (y) {
      const state = this.ys.get(y)
      this.redisClient.send_command('INCR', [y.room + ':contentClock'])
      return ++state.contentClock
    }

    /**
     * The Yjs instance has been modified, save the updates to the redis store.
     * This method is called after each transaction.
     */
    saveUpdate (y, update, transaction) {
      const incrementContentClock = this.contentCheck(y, transaction)
      const state = this.ys.get(y)
      if (incrementContentClock) {
        state.contentClock++
      }
      this.redisClient.send_command('EVALSHA', [saveUpdateCommandSha, 2, y.room + ':updates', y.room + ':contentClock', Buffer.from(update), incrementContentClock ? 'true' : 'false'], function (err) {
        if (err !== null) {
          throw err
        }
      })
    }

    /**
     * Retrieve the binary representation of the model and all unapplied updates
     * from the redis database. Then read the binary representation and apply
     * the updates.
     */
    retrieve (y) {
      const room = y.room
      const state = this.ys.get(y)
      return new Promise((resolve, reject) => {
        if (state.counter === 0) {
          // retrieve initial model
          this.redisClient.multi()
            .get(room + ':model')
            .lrange(room + ':updates', 0, -1)
            .get(room + ':counter')
            .get(room + ':extra')
            .get(room + ':contentClock')
            .exec((err, [model, updates, counter, extra, contentClock]) => {
              if (err !== null) {
                reject(err)
                return
              }
              contentClock = contentClock || '0'
              updates = updates || []
              extra = extra ? extra.toString() : null
              if (counter === null) {
                state.counter = updates.length
              } else {
                state.counter = Number.parseInt(counter + '') + updates.length
              }
              super.retrieve(y, model, updates)
              state.contentClock = Number.parseInt(contentClock.toString())
              const result = {
                extra: extra,
                contentClock: state.contentClock
              }
              y.emit('redis-content-retrieved', result)
              resolve(result)
            })
        } else {
          // only retrieve missing updates
          this.redisClient.send_command('EVALSHA', [getRemainingUpdatesSha, 4, room + ':counter', room + ':updates', room + ':contentClock', room + ':extra', state.counter], (err, [updates, contentClock, extra]) => {
            if (err !== null) {
              reject(err)
              return
            }
            extra = extra ? extra.toString() : null
            // increase known updates counter
            state.counter += updates.length
            // apply updates
            super.retrieve(y, null, updates)
            state.contentClock = Number.parseInt(contentClock.toString())
            const result = {
              extra: extra,
              contentClock: state.contentClock
            }
            y.emit('redis-content-retrieved', result)
            resolve(result)
          })
        }
      })
    }

    /**
     * Save the binary representation of the shared data.
     */
    persist (y, extra) {
      const state = this.ys.get(y)
      return new Promise((resolve, reject) => {
        const room = y.room
        // save model and delete known updates
        const binaryModel = Buffer.from(super.persist(y))
        const args = [saveYjsModelSha, 4, room + ':counter', room + ':updates', room + ':model', room + ':extra', state.counter, binaryModel]
        if (extra !== undefined) {
          args.push(extra)
        }
        this.redisClient.send_command('EVALSHA', args, (err, res) => {
          if (err !== null) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }
  }

  return YRedisPersistence
}

module.exports = extendRedisPersistence

/*
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
*/
