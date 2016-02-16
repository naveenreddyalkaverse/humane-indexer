import _ from 'lodash';
import Config from 'config';
import Promise from 'bluebird';
import RedisLock from 'redislock';
import SemLocks from 'semlocks';

import performanceNow from 'performance-now';

import redisClient from './RedisClient';

const LockAcquisitionError = RedisLock.LockAcquisitionError;
const LockReleaseError = RedisLock.LockReleaseError;

const logLevel = Config.has('LOG') ? Config.get('LOG') : 'info';

class DistributedLock {
    constructor() {
        this.redisClient = redisClient();
        const lockConfig = Config.has('LOCKS') && Config.get('LOCKS');
        RedisLock.setDefaults({
            timeout: lockConfig.timeout || 200000,
            retries: lockConfig.retries || 1000,
            delay: lockConfig.delay || 100
        });
    }

    acquire(key) {
        const lock = RedisLock.createLock(this.redisClient);

        return lock.acquire(key)
          .then(() => ({
              key,
              release: () => {
                  if (logLevel === 'trace') {
                      console.log('Releasing lock: ', key);
                  }

                  return lock.release()
                    .then(() => {
                        if (logLevel === 'trace') {
                            console.log('Released lock: ', key);
                        }

                        return true;
                    })
                    .catch(LockReleaseError, (error) => {
                        console.error('Error in releasing lock: ', key, error);

                        //throw error;
                        return true;
                    });
              }
          }))
          .catch(LockAcquisitionError, (error) => {
              console.error('Error in acquiring lock: ', error);
              return Promise.reject({key, error: true, details: error});
          });
    }

    shutdown() {
        if (logLevel === 'trace') {
            console.log('Shutting down: DistributedLock');
        }

        this.redisClient.end(true);
        return true;
    }
}

class LocalLock {
    constructor() {
        this.locks = SemLocks;
    }

    acquire(key) {
        return new Promise((resolve, reject) => {
            //console.log('Acquiring lock: ', key);
            this.locks.acquire(key, (err, release) => {
                if (err) {
                    console.error('Error in acquiring lock: ', key, err);
                    reject({key, error: true, details: err});
                    return;
                }

                //console.log('Acquired lock: ', key);
                resolve({key, release});
            });
        });
    }

    shutdown() {
        delete this.locks;
        return true;
    }
}

export default class Lock {
    constructor() {
        let mode = 'local';
        if (Config.has('LOCKS') && Config.get('LOCKS').type === 'redis') {
            mode = 'redis';
        }

        if (mode === 'redis') {
            this.instance = new DistributedLock();
        } else {
            this.instance = new LocalLock();
        }
    }

    acquire(key) {
        if (logLevel === 'trace') {
            const startTime = performanceNow();

            return this.instance.acquire(key)
              .then((result) => {
                  console.log('Acquired lock: ', key, (performanceNow() - startTime).toFixed(3));
                  return result;
              });
        }

        return this.instance.acquire(key);
    }

    usingLock(operation, key, lockHandle, log) {
        let finalResult = null;

        const startTime = performanceNow();

        if (lockHandle) {
            return operation(lockHandle)
              .then(result => {
                  if (log) log((performanceNow() - startTime).toFixed(3));

                  return result;
              });
        }

        //const acquireLock = () =>
        //  this.acquire(key).disposer((lockHandle, promise) => {
        //      return lockHandle.release();
        //  });

        return this.acquire(key)

          .then(handle => {
              lockHandle = handle;

              return operation(lockHandle);
          })

          //.finally(() => lockHandle.release())

          .then((result) => {
              finalResult = result;

              return lockHandle.release();
          })

          .then(() => {
              if (log) log((performanceNow() - startTime).toFixed(3));

              return finalResult;
          });
    }

    shutdown() {
        if (logLevel === 'trace') {
            console.log('Shutting down: Lock');
        }

        return this.instance.shutdown();
    }
}