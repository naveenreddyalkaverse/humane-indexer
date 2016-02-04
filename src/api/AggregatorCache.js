import _ from 'lodash';
import Config from 'config';
import Promise from 'bluebird';
import Chalk from 'chalk';

import performanceNow from 'performance-now';

import redisClient from './RedisClient';

const FlushSchedulerKey = 'aggregate-flusher';

const logLevel = Config.has('LOG') ? Config.get('LOG') : 'info';

class DistributedCache {
    constructor() {
        this.redisClient = redisClient();
    }

    static getKey(key) {
        return `aggregate:${key}`;
    }

    store(key, data) {
        return this.redisClient.setAsync(DistributedCache.getKey(key), JSON.stringify(data))
          .then(() => data);
    }

    retrieve(key) {
        return this.redisClient.getAsync(DistributedCache.getKey(key))
          .then((data) => !!data ? JSON.parse(data) : null);
    }

    remove(key) {
        return this.redisClient.delAsync(DistributedCache.getKey(key));
    }

    keys() {
        // TODO: probably SCAN based implementation is better, but there may not be many keys too...
        return this.redisClient.keysAsync('aggregate:*')
          .then((keys) => keys.map(key => key.substring(10, key.length)));
    }

    shutdown() {
        this.redisClient.end(true);
        return true;
    }
}

class LocalCache {
    constructor() {
        this.cache = {};
    }

    store(key, data) {
        this.cache[key] = data;
        return data;
    }

    retrieve(key) {
        return this.cache[key];
    }

    remove(key) {
        this.cache[key] = undefined;
        delete this.cache[key];
        return true;
    }

    keys() {
        return _.keys(this.cache);
    }

    shutdown() {
        delete this.cache;
        return true;
    }
}

export default class Cache {
    constructor(indexer, lock) {
        let mode = 'local';
        if (Config.has('CACHE') && Config.get('CACHE').type === 'redis') {
            mode = 'redis';
        }

        if (mode === 'redis') {
            this.instance = new DistributedCache();
        } else {
            this.instance = new LocalCache();
        }

        this.scheduleHandle = null;
        this.schedule = null;

        this.indexer = indexer;
        this.lock = lock;
    }

    store(key, data) {
        // if no schedule then create a schedule
        if (!this.schedule) {
            this.scheduleFlush();
        }

        if (logLevel === 'trace') {
            const startTime = performanceNow();
            return this.instance.store(key, data)
              .then((result) => {
                  console.log('Stored key: ', key, (performanceNow() - startTime).toFixed(3));
                  return result;
              });
        }

        return this.instance.store(key, data);
    }

    retrieve(key) {
        if (logLevel === 'trace') {
            const startTime = performanceNow();
            return this.instance.retrieve(key)
              .then((result) => {
                  console.log('Retrieved key: ', key, (performanceNow() - startTime).toFixed(3));
                  return result;
              });
        }

        return this.instance.retrieve(key);
    }

    remove(key) {
        if (logLevel === 'trace') {
            const startTime = performanceNow();
            return this.instance.remove(key)
              .then((result) => {
                  console.log('Removed key: ', key, (performanceNow() - startTime).toFixed(3));
                  return result;
              });
        }

        return this.instance.remove(key);
    }

    keys() {
        return this.instance.keys();
    }

    scheduleFlush() {
        console.log(Chalk.yellow('Scheduling Flush'));
        return this.lock.acquire(FlushSchedulerKey)
          .then(handle => {
              if (!this.schedule) {
                  this.scheduleHandle = _.delay(this.flush.bind(this), 10000);
                  this.schedule = true;
              }

              handle.release();

              console.log(Chalk.yellow('Scheduled Flush'));

              return true;
          });
    }

    removeFlushSchedule() {
        console.log(Chalk.yellow('Removing Flush Schedule'));
        return this.lock.acquire(FlushSchedulerKey)
          .then(handle => {
              if (this.schedule) {
                  if (this.scheduleHandle) {
                      clearTimeout(this.scheduleHandle);
                  }

                  this.scheduleHandle = null;
                  this.schedule = null;
              }

              handle.release();

              console.log(Chalk.yellow('Removed Flush Schedule'));

              return true;
          });
    }

    flush(noSchedule) {
        console.log();
        console.log(Chalk.yellow('------------------------------------------------------'));
        console.log(Chalk.yellow('Starting aggregate flush...'));
        return Promise.resolve(this.keys())
          .then(keys => {
              if (!keys || _.isEmpty(keys)) {
                  return this.removeFlushSchedule();
              }

              return Promise.map(keys, (key) => this.indexer.flushAggregate(key), {concurrency: 3})
                .then(() => {
                    console.log(Chalk.yellow('...Finished aggregate flush'));
                    console.log(Chalk.yellow('------------------------------------------------------'));

                    this.schedule = null;
                    this.scheduleHandle = null;

                    if (!noSchedule) {
                        return this.scheduleFlush();
                    }

                    return true;
                });
          });
    }

    shutdown() {
        // first flush, then shutdown the instance
        return Promise.resolve(this.flush(true))
          .then(() => this.instance.shutdown());
    }
}