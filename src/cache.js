const LRU = require('lru-cache');
const IORedis = require('ioredis');
const { REDIS_URL } = require('./config');

const memoryCache = new LRU({ max: 500, ttl: 1000 * 60 * 10 }); // 10 minutes

let redisClient = null;
if (REDIS_URL) {
  redisClient = new IORedis(REDIS_URL);
  redisClient.on('error', (e) => console.error('Redis error', e));
}

async function get(key) {
  if (redisClient) {
    const v = await redisClient.get(key);
    return v ? JSON.parse(v) : null;
  }
  return memoryCache.get(key);
}

async function set(key, value, ttlSec = 600) {
  if (redisClient) {
    await redisClient.set(key, JSON.stringify(value), 'EX', ttlSec);
    return;
  }
  memoryCache.set(key, value, { ttl: ttlSec * 1000 });
}

module.exports = { get, set };
