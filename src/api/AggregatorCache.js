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
        if (logLevel === 'trace') {
            console.log('Shutting down: DistributedCache');
        }

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
            if (logLevel === 'trace') {
                console.log('Store: Scheduling Flush: No Keys');
            }

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

        const operation = () => {
            if (!this.schedule) {
                this.scheduleHandle = _.delay(this.flush.bind(this), 10000);
                this.schedule = true;

                console.log(Chalk.yellow(`Scheduled Flush: ${this.scheduleHandle}`));
            } else {
                console.log(Chalk.yellow(`Schedule already exist`));
            }

            return true;
        };

        return this.lock.usingLock(operation, FlushSchedulerKey);
    }

    removeFlushSchedule() {
        console.log(Chalk.yellow('Removing Flush Schedule'));
        const operation = () => {
            if (this.schedule) {
                if (this.scheduleHandle) {
                    clearTimeout(this.scheduleHandle);
                }

                this.scheduleHandle = null;
                this.schedule = null;
            }

            return true;
        };

        return this.lock.usingLock(operation, FlushSchedulerKey, null,
          (timeTaken) => console.log(Chalk.yellow('Removed Flush Schedule')));
    }

    flush(noSchedule) {
        console.log();
        console.log(Chalk.yellow('------------------------------------------------------'));
        console.log(Chalk.yellow('Starting aggregate flush...'));

        if (logLevel === 'trace') {
            console.log('Flushing: AggregatorCache. NoSchedule: ', noSchedule);
        }

        return Promise.resolve(this.keys())
          .then(keys => {
              if (!keys || _.isEmpty(keys)) {
                  if (logLevel === 'trace') {
                      console.log('Removing Flush Schedule: found no keys');
                  }

                  return this.removeFlushSchedule();
              }

              return Promise.map(keys, (key) => this.indexer.flushAggregate(key), {concurrency: 3})
                .then(() => {
                    console.log(Chalk.yellow('...Finished aggregate flush'));
                    console.log(Chalk.yellow('------------------------------------------------------'));

                    if (!noSchedule) {
                        this.schedule = null;
                        this.scheduleHandle = null;

                        return this.scheduleFlush();
                    }

                    if (logLevel === 'trace') {
                        console.log('Removing Flush Schedule: noSchedule: ', noSchedule);
                    }

                    return this.removeFlushSchedule();
                });
          });
    }

    shutdown() {
        // first flush, then shutdown the instance
        if (logLevel === 'trace') {
            console.log('Shutting down: AggregatorCache');
        }

        return Promise.resolve(this.removeFlushSchedule())
          .then(() => this.flush(true))
          .then(() => this.instance.shutdown())
          .then(() => {
              console.log('Shut down: AggregatorCache');

              return true;
          });
    }
}