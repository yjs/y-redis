/**
 * 
 * @param {string} redisWorkerStreamName 
 * @param {string} redisWorkerGroupName 
 * @returns string
 */
export const addMessageCommand = (redisWorkerStreamName, redisWorkerGroupName) => {
  return `
        if redis.call("EXISTS", KEYS[1]) == 0 then
          redis.call("XADD", "${redisWorkerStreamName}", "*", "compact", KEYS[1])
          redis.call("XREADGROUP", "GROUP", "${redisWorkerGroupName}", "pending", "STREAMS", "${redisWorkerStreamName}", ">")
        end
        redis.call("XADD", KEYS[1], "*", "m", ARGV[1])
      `
}

export const xDelIfEmptyCommand = () => {
  return `
        if redis.call("XLEN", KEYS[1]) == 0 then
          redis.call("DEL", KEYS[1])
        end
      `
}
