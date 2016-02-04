import Config from 'config';
import Redis from 'redis';
import RedisSentinel from 'redis-sentinel';
import Promise from 'bluebird';

function promisify(client) {
    return Promise.promisifyAll(client);
}

export default function () {
    const redisSentinelConfig = Config.has('REDIS-SENTINEL') && Config.get('REDIS-SENTINEL');
    if (redisSentinelConfig) {
        return promisify(RedisSentinel.createClient(redisSentinelConfig.endpoints, redisSentinelConfig.name));
    }

    const redisConfig = Config.has('REDIS') && Config.get('REDIS');
    if (redisConfig) {
        return promisify(Redis.createClient(redisConfig));
    }

    return promisify(Redis.createClient());
}