import { transformStreamMessagesReply } from '@redis/client/dist/lib/commands/generic-transformers.js';
import { transformReply } from '@redis/client/dist/lib/commands/XAUTOCLAIM.js';
import { Redis } from 'ioredis';
import { addMessageCommand, xDelIfEmptyCommand } from './commands.js';


export class IoRedisAdapter {
    /**
     * 
     * @param { Redis } redis 
     * @param { string } redisWorkerStreamName
     * @param { string } redisWorkerGroupName
     */
    constructor(redis, redisWorkerStreamName, redisWorkerGroupName) {
        this.redisWorkerStreamName = redisWorkerStreamName
        this.redisWorkerGroupName = redisWorkerGroupName
        this.redis = redis

        this.redis.defineCommand('addMessage', {
            numberOfKeys: 1,
            lua: addMessageCommand(this.redisWorkerStreamName, this.redisWorkerGroupName),
        });

        this.redis.defineCommand('xDelIfEmpty', {
            numberOfKeys: 1,
            lua: xDelIfEmptyCommand(),
        });
    }

    /**
     * 
     * @param {string} key 
     * @param {*} message 
     * @returns 
     */
    async addMessage(key, message) {
        // @ts-ignore
        const res = this.redis.addMessage(key, message)

        return res
    }

    /**
     * 
     * @param {string} streamName 
     * @returns 
     */
    getEntriesLen(streamName) {
        return this.redis.xlen(streamName)
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
        return this.redis.xgroup(
            'CREATE',
            this.redisWorkerStreamName,
            this.redisWorkerGroupName,
            '0',
            'MKSTREAM'
        )
    }

    async quit() {
        return this.redis.quit()
    }

    /**
   * @param {Array<{key:string,id:string}>} streams streamname-clock pairs
   * @returns {Promise<{name:Buffer,messages:Array<import('@redis/client/dist/lib/commands/generic-transformers.js').StreamMessageReply>}[]>}
   */
    async readStreams(streams) {
        const reads = await this.redis.xreadBuffer(
            "COUNT", 1000,
            "BLOCK", 1000,
            "STREAMS",
            ...streams.map(stream => stream.key),
            ...streams.map(stream => stream.id),
        )

        // @ts-ignore
        const streamReplyRes = this.normalizeStreamMessagesReply(reads)

        return streamReplyRes
    }

    /**
     * 
     * @param {string} computeRedisRoomStreamName 
     */
    async readMessagesFromStream(computeRedisRoomStreamName) {
        const reads = await this.redis.xreadBuffer(
            'COUNT', 1000, // Adjust the count as needed
            'BLOCK', 1000, // Adjust the block time as needed
            "STREAMS",
            computeRedisRoomStreamName,
            '0'
        )

        // @ts-ignore
        const streamReplyRes = this.normalizeStreamMessagesReply(reads)

        return streamReplyRes
    }

    /**
     * 
     * @param {string} consumerName 
     * @param {number} redisTaskDebounce 
     * @param {number} tryClaimCount 
     */
    async reclaimTasks(consumerName, redisTaskDebounce, tryClaimCount = 5) {
        const reclaimedTasks = await this.redis.xautoclaim(
            this.redisWorkerStreamName,
            this.redisWorkerGroupName,
            consumerName,
            redisTaskDebounce,
            '0',
            'COUNT',
            tryClaimCount
        )
        // @ts-ignore
        const reclaimedTasksRes = transformReply(reclaimedTasks)

        return reclaimedTasksRes
    }

    /**
     * @param {{ stream: import("ioredis").RedisKey; id: any; }} task
     */
    async tryClearTask(task) {
        const streamlen = await this.redis.xlen(task.stream)

        if (streamlen === 0) {
            await this.redis.multi()
                // @ts-ignore
                .xDelIfEmpty(task.stream)
                .xdel(this.redisWorkerStreamName, task.id)
                .exec()
        }

        return streamlen;
    }

    /**
     * 
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
            .xtrim(task.stream, 'MINID', lastId - redisMinMessageLifetime)
            .xadd(
                this.redisWorkerStreamName,
                '*',
                "compact",
                task.stream)
            .xreadgroup('GROUP', this.redisWorkerGroupName, 'pending', 'COUNT', 50, 'STREAMS', this.redisWorkerStreamName, '>') // immediately claim this entry, will be picked up by worker after timeout
            .xdel(this.redisWorkerStreamName, task.id)
            .exec()
    }

    normalizeStreamMessagesReply = (/** @type {any[]} */ streamReply) => {
        const streamReplyRes = streamReply?.map((item) => {
            // @ts-ignore
            const [name, messages] = item
            return {
                name,
                messages: transformStreamMessagesReply(messages)
            }
        })

        return streamReplyRes
    }
}
