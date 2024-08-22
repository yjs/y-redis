import * as node_redis from 'redis';
import { addMessageCommand, xDelIfEmptyCommand } from './commands.js';


export class NodeRedisAdapter {

    /**
     * 
     * @param { import('redis').RedisClientType } redis 
     * @param { string } redisWorkerStreamName
     * @param { string } redisWorkerGroupName
     */
    constructor(redis, redisWorkerStreamName, redisWorkerGroupName) {
        this.redisWorkerStreamName = redisWorkerStreamName,
        this.redisWorkerGroupName = redisWorkerGroupName,
        this.redis = redis
        this.addMessageScript = node_redis.defineScript({
            NUMBER_OF_KEYS: 1,
            SCRIPT: addMessageCommand(this.redisWorkerStreamName, this.redisWorkerGroupName),
            /**
             * @param {string} key
             * @param {Buffer} message
             */
            transformArguments(key, message) {
                return [key, message]
            },
            /**
             * @param {null} x
             */
            transformReply(x) {
                return x
            }
        })

        this.xDelIfEmptyScript = node_redis.defineScript({
            NUMBER_OF_KEYS: 1,
            SCRIPT: xDelIfEmptyCommand(),
            /**
             * @param {string} key
             */
            transformArguments(key) {
                return [key]
            },
            /**
             * @param {null} x
             */
            transformReply(x) {
                return x
            }
        })
    }


    /**
     * 
     * @param {string} key 
     * @param {*} message 
     * @returns 
     */
    async addMessage(key, message) {
        const res = this.redis.executeScript(this.addMessageScript, [key, message], node_redis.commandOptions({ returnBuffers: true }))

        return res
    }

    /**
     * 
     * @param {string} streamName 
     * @returns 
     */
    getEntriesLen(streamName) {
        return this.redis.xLen(streamName)
    }

    /**
     * 
     * @param {string} stream 
     * @returns 
     */
    exists(stream) {
        return this.redis.exists(stream)
    }

    async createGroup() {
        return this.redis.xGroupCreate(this.redisWorkerStreamName, this.redisWorkerGroupName, '0', { MKSTREAM: true })
    }

    async quit() {
        return this.redis.quit()
    }

    /**
   * @param {Array<{key:string,id:string}>} streams streamname-clock pairs
   */
    async readStreams(streams) {
        const reads = await this.redis.xRead(
            node_redis.commandOptions({ returnBuffers: true }),
            streams,
            { BLOCK: 1000, COUNT: 1000 }
        )

        return reads
    }

    /**
     *
     * @param {string} computeRedisRoomStreamName 
     */
    async readMessagesFromStream(computeRedisRoomStreamName) {
        const reads = await this.redis.xRead(
            node_redis.commandOptions({ returnBuffers: true }),
            { key: computeRedisRoomStreamName, id: '0' })

        return reads
    }

    /**
     *
     * @param {string} consumerName
     * @param {number} redisTaskDebounce
     * @param {number} tryClaimCount
     */
    async reclaimTasks(consumerName, redisTaskDebounce, tryClaimCount = 5) {
        const reclaimedTasks = await this.redis.xAutoClaim(
            this.redisWorkerStreamName,
            this.redisWorkerGroupName,
            consumerName,
            redisTaskDebounce,
            '0',
            { COUNT: tryClaimCount }
        )

        return reclaimedTasks
    }

    /**
     * @param {{ stream: import("ioredis").RedisKey; id: any; }} task
     */
    async tryClearTask(task) {
        const streamlen = await this.redis.xLen(task.stream)

        if (streamlen === 0) {
            await this.redis.multi()
                .scriptsExecutor(this.xDelIfEmptyScript, [task.stream])
                .xDel(this.redisWorkerStreamName, task.id)
                .exec()
        }

        return streamlen;
    }

    /**
     * @param {{ stream: import("ioredis").RedisKey; id: any; }} task 
     * @param {number} lastId 
     * @param {number} redisMinMessageLifetime 
     */
    async tryDeduplicateTask(task, lastId, redisMinMessageLifetime) {
        // if `redisTaskDebounce` is small, or if updateCallback taskes too long, then we might
        // add a task twice to this list.
        // @todo either use a different datastructure or make sure that task doesn't exist yet
        // before adding it to the worker queue
        // This issue is not critical, as no data will be lost if this happens.
        this.redis.multi()
            .xTrim(task.stream, 'MINID', lastId - redisMinMessageLifetime)
            .xAdd(this.redisWorkerStreamName, '*', { compact: task.stream })
            .xReadGroup(this.redisWorkerGroupName, 'pending', { key: this.redisWorkerStreamName, id: '>' }, { COUNT: 50 }) // immediately claim this entry, will be picked up by worker after timeout
            .xDel(this.redisWorkerStreamName, task.id)
            .exec()
    }
}
