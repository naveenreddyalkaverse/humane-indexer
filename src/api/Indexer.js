import _ from 'lodash';
import Config from 'config';
import Agent from 'agentkeepalive';
import Promise from 'bluebird';
import Request from 'request';
import Chalk from 'chalk';

import performanceNow from 'performance-now';

import Lock from './Lock';
import AggregatorCache from './AggregatorCache';

const ESConfig = Config.get('ES');
const Url = ESConfig.url || 'http://localhost:9200';

const logLevel = Config.has('LOG') ? Config.get('LOG') : 'info';

const ADD_OP = 'add';
const REMOVE_OP = 'remove';
const UPDATE_OP = 'update';

const AGGREGATE_MODE = 'aggregate';

//
// Actual implementation is in Internal class for API class to look readable and simple.
//
class IndexerInternal {
    constructor(indicesConfig) {
        const keepAliveAgent = new Agent({
            maxSockets: ESConfig.maxSockets || 10,
            maxFreeSockets: ESConfig.maxFreeSockets || 5,
            timeout: ESConfig.timeout || 60000,
            keepAliveTimeout: ESConfig.keepAliveTimeout || 30000
        });

        this.request = Promise.promisify(Request.defaults({
            json: true,
            agent: keepAliveAgent,
            baseUrl: `${Url}`
        }));

        this.lock = new Lock();

        this.aggregatorCache = new AggregatorCache(this, this.lock);

        // TODO: validate indices config are proper
        this.indicesConfig = indicesConfig;
    }

    shutdown() {
        return Promise.resolve(this.aggregatorCache.shutdown())
          .then(() => this.lock.shutdown());
    }

    static successResponse(response) {
        if (!response) {
            return false;
        }

        if (_.isArray(response)) {
            response = response[0];
        }

        if (logLevel === 'debug' || (response.statusCode >= 300 && response.statusCode !== 404 && response.request.method !== 'HEAD')) {
            console.log();
            console.log(Chalk.blue('------------------------------------------------------'));
            console.log(Chalk.blue.bold(`${response.request.method} ${response.request.href}`));

            const format = response.statusCode < 300 ? Chalk.green : Chalk.red;

            console.log(format(`Status: ${response.statusCode}`));

            if (response.request.method !== 'HEAD') {
                console.log(format(JSON.stringify(response.body, null, 2)));
            }

            console.log(Chalk.blue('------------------------------------------------------'));
            console.log();
        }

        return response.statusCode < 300 ? response.body : null;
    }

    typeConfig(typeOrConfig) {
        if (_.isString(typeOrConfig)) {
            return this.indicesConfig.types[typeOrConfig];
        }

        return typeOrConfig;
    }

    // TODO: support specific index deletion
    deleteIndex() {
        const promises = _(this.indicesConfig.indices)
          .values()
          .map((value) => this.request({method: 'DELETE', uri: `${value.store}`}))
          .value();

        return Promise.all(promises)
          .then(response => _.map(response, IndexerInternal.successResponse))
          .then((response) => _.every(response, Boolean));
    }

    // TODO: support specific index creation
    createIndex() {
        const promises = _(this.indicesConfig.indices)
          .values()
          .map((value) => {
              const mappings = {};

              _(this.indicesConfig.types)
                .values()
                .filter(type => type.index === value.store)
                .forEach(type => {
                    mappings[type.type] = type.mapping;
                });

              return this.request({
                  method: 'PUT',
                  uri: `${value.store}`,
                  body: {settings: {analysis: value.analysis}, mappings}
              });
          })
          .value();

        return Promise.all(promises)
          .then(response => _.map(response, IndexerInternal.successResponse))
          .then((response) => _.every(response, Boolean));
    }

    exists(typeOrConfig, id) {
        const typeConfig = this.typeConfig(typeOrConfig);
        return this.request({method: 'HEAD', uri: `${typeConfig.index}/${typeConfig.type}/${id}`})
          .then(IndexerInternal.successResponse);
    }

    get(typeOrConfig, id) {
        const typeConfig = this.typeConfig(typeOrConfig);
        return this.request({method: 'GET', uri: `${typeConfig.index}/${typeConfig.type}/${id}`})
          .then(IndexerInternal.successResponse)
          .then((response) => response ? response._source : response);
    }

    buildAggregates(typeOrConfig, newDoc, existingDoc) {
        const aggregatorsConfig = this.indicesConfig.aggregators[_.isString(typeOrConfig) ? typeOrConfig : typeOrConfig.type];
        if (!aggregatorsConfig) {
            return false;
        }

        let newMeasures = null;
        if (newDoc) {
            newMeasures = {};
            _(aggregatorsConfig.measures).forEach(measure => newMeasures[measure] = newDoc[measure]);
        }

        let existingMeasures = null;
        if (existingDoc) {
            existingMeasures = {};
            _(aggregatorsConfig.measures).forEach(measure => existingMeasures[measure] = existingDoc[measure]);
        }

        const promises = [];

        const getFieldValues = (aggregateConfig, typeConfig, doc) => {
            const fieldValues = [];

            if (!doc) {
                return fieldValues;
            }

            let docField = doc[aggregateConfig.field];
            if (!docField) {
                return fieldValues;
            }

            if (!_.isArray(docField)) {
                docField = [docField];
            }

            _.forEach(docField, fieldValue => {
                if (!fieldValue) {
                    return true;
                }

                const data = aggregateConfig.dataBuilder(doc, fieldValue);
                const id = this.typeConfig(typeConfig).id(data);
                fieldValues.push({id, data});
                return true;
            });

            return fieldValues;
        };

        const buildFieldValueAggregate = (fieldValue, aggregateConfig, typeConfig, opType) => {
            const id = fieldValue.id;
            const data = fieldValue.data;

            let lockHandle = null;

            const key = `${typeConfig.type}:${id}`;

            const promise = this.lock.acquire(key)
              .then(handle => {
                  lockHandle = handle;

                  return this.aggregatorCache.retrieve(key);
              })
              .then(cachedFieldDoc => {
                  if (!cachedFieldDoc) {
                      return this.get(typeConfig, id)
                        .then(result => (result && {doc: result, opType, id, type: typeConfig.type} || null));
                  }

                  return cachedFieldDoc;
              })
              .then(existingFieldDoc => {
                  const aggregates = aggregateConfig.aggregateBuilder(existingFieldDoc && existingFieldDoc.doc, opType !== ADD_OP ? existingMeasures : null, opType === REMOVE_OP ? null : newMeasures);
                  const newFieldDoc = _.extend(existingFieldDoc && existingFieldDoc.doc || {}, data, aggregates);

                  //if (mode !== ADD) {
                  //    return this.update(typeConfig, id, newFieldDoc, existingFieldDoc, lockHandle);
                  //}
                  //
                  //return this.add(typeConfig, newFieldDoc, id, lockHandle);

                  return this.aggregatorCache.store(key, {doc: newFieldDoc, opType, id, type: typeConfig.type});
              })
              .then((result) => {
                  lockHandle.release();

                  return result;
              });

            promises.push(promise);
        };

        _(aggregatorsConfig.aggregates)
          .values()
          .forEach((aggregateConfig) => {
              const typeConfig = aggregateConfig.indexType;

              const newDocFieldValues = getFieldValues(aggregateConfig, typeConfig, newDoc);
              const existingDocFieldValues = getFieldValues(aggregateConfig, typeConfig, existingDoc);

              const fieldValuesToAdd = []; // if in newDoc, but not in existingDoc
              const fieldValuesToRemove = []; // if not in newDoc, but in existingDoc
              const fieldValuesToUpdate = []; // if in both newDoc and existingDoc

              _.forEach(newDocFieldValues, newDocFieldValue => {
                  let found = false;
                  _.forEach(existingDocFieldValues, existingDocFieldValue => {
                      if (newDocFieldValue.id === existingDocFieldValue.id) {
                          found = true;
                          return false;
                      }
                  });

                  if (found) {
                      fieldValuesToUpdate.push(newDocFieldValue);
                  } else {
                      fieldValuesToAdd.push(newDocFieldValue);
                  }
              });

              _.forEach(existingDocFieldValues, existingDocFieldValue => {
                  let found = false;
                  _.forEach(newDocFieldValues, newDocFieldValue => {
                      if (newDocFieldValue.id === existingDocFieldValue.id) {
                          found = true;
                          return false;
                      }
                  });

                  if (!found) {
                      fieldValuesToRemove.push(existingDocFieldValue);
                  }
              });

              _.forEach(fieldValuesToAdd, fieldValue => buildFieldValueAggregate(fieldValue, aggregateConfig, typeConfig, ADD_OP));
              _.forEach(fieldValuesToRemove, fieldValue => buildFieldValueAggregate(fieldValue, aggregateConfig, typeConfig, REMOVE_OP));
              _.forEach(fieldValuesToUpdate, fieldValue => buildFieldValueAggregate(fieldValue, aggregateConfig, typeConfig, UPDATE_OP));
          });

        return Promise.all(promises).then((responses) => _.every(responses, response => !!response));
    }

    flushAggregate(key) {
        let lockHandle = null;

        // take lock for the key
        // make the op
        // remove the entry
        // release the lock

        console.log(Chalk.yellow(`Flushing Key: ${key}`));

        return this.lock.acquire(key)
          .then(handle => {
              lockHandle = handle;

              return this.aggregatorCache.retrieve(key);
          })
          .then(cachedAggregate => {
              if (!cachedAggregate) {
                  return null;
              }

              const {doc, opType, type, id} = cachedAggregate;

              if (opType !== ADD_OP) {
                  return this.update(type, id, doc, null, lockHandle);
              }

              //console.log('Flushing: ', doc);
              return this.add(type, doc, id, lockHandle);
          })
          .then((result) => {
              if (result) {
                  this.aggregatorCache.remove(key);
              }

              lockHandle.release();

              console.log(Chalk.yellow(`Flushed Key: ${key}`));

              return result;
          });
    }

    add(typeOrConfig, doc, id, lockHandle) {
        const typeConfig = this.typeConfig(typeOrConfig);
        const transform = typeConfig.transform;
        if (transform && _.isFunction(transform)) {
            transform(doc);
        }

        id = id || typeConfig.id(doc);

        let result = null;

        const filter = typeConfig.filter;
        if (filter && _.isFunction(filter) && !filter(doc)) {
            return false;
        }

        const operation = () =>
          this.request({method: 'PUT', uri: `${typeConfig.index}/${typeConfig.type}/${id}`, body: doc})
            .then(IndexerInternal.successResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, doc);
            })
            .then(() => result);

        if (lockHandle) {
            return operation();
        }

        return this.lock.acquire(`${typeOrConfig}:${id}`)
          .then(handle => {
              lockHandle = handle;

              return operation();
          })
          .then((response) => {
              lockHandle.release();

              return response;
          });
    }

    remove(typeOrConfig, id, existingDoc, lockHandle) {
        const typeConfig = this.typeConfig(typeOrConfig);

        let result = null;

        const operation = () =>
          Promise.resolve(existingDoc || this.get(typeOrConfig, id))
            .then(response => existingDoc = response)
            .then(() => this.request({method: 'DELETE', uri: `${typeConfig.index}/${typeConfig.type}/${id}`}))
            .then(IndexerInternal.successResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, null, existingDoc);
            })
            .then(() => result);

        if (lockHandle) {
            return operation();
        }

        return this.lock.acquire(`${typeConfig.type}:${id}`)
          .then(handle => {
              lockHandle = handle;

              return operation();
          })
          .then((response) => {
              lockHandle.release();

              return response;
          });
    }

    update(typeOrConfig, id, newDoc, existingDoc, lockHandle) {
        const typeConfig = this.typeConfig(typeOrConfig);
        const transform = typeConfig.transform;
        if (transform && _.isFunction(transform)) {
            transform(newDoc);
        }

        let result = null;

        const filter = typeConfig.filter;
        if (filter && _.isFunction(filter) && !filter(newDoc)) {
            return this.remove(typeOrConfig, id, existingDoc);
        }

        const operation = () =>
          Promise.resolve(existingDoc || this.get(typeOrConfig, id))
            .then(response => existingDoc = response)
            .then(() => this.request({method: 'POST', uri: `${typeConfig.index}/${typeConfig.type}/${id}/_update`, body: {doc: newDoc}}))
            .then(IndexerInternal.successResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, newDoc, existingDoc);
            })
            .then(() => result);

        if (lockHandle) {
            return operation();
        }

        return this.lock.acquire(`${typeConfig.type}:${id}`)
          .then(handle => {
              lockHandle = handle;

              return operation();
          })
          .then((response) => {
              lockHandle.release();

              return response;
          });
    }

    upsert(typeOrConfig, doc) {
        let lockHandle = null;

        const typeConfig = this.typeConfig(typeOrConfig);

        const mode = typeConfig.mode;

        const id = typeConfig.id(doc);

        const key = `${typeConfig.type}:${id}`;

        // for now upsert operation is the only supported for aggregate mode
        if (mode && mode === AGGREGATE_MODE) {
            let startTime = null;
            if (logLevel === 'trace') {
                startTime = performanceNow();
            }

            return this.lock.acquire(key)
              .then(handle => {
                  lockHandle = handle;

                  return this.aggregatorCache.retrieve(key);
              })
              .then(cachedDoc => {
                  if (!cachedDoc) {
                      return this.get(typeConfig, id)
                        .then(result => (result && {doc: result, opType: UPDATE_OP, id, type: typeConfig.type} || null));
                  }

                  return cachedDoc;
              })
              .then(existingDoc => {
                  const newDoc = typeConfig.aggregateBuilder(existingDoc && existingDoc.doc, doc);

                  //if (mode !== ADD) {
                  //    return this.update(typeConfig, id, newFieldDoc, existingFieldDoc, lockHandle);
                  //}
                  //
                  //return this.add(typeConfig, newFieldDoc, id, lockHandle);

                  return this.aggregatorCache.store(key, {doc: newDoc, opType: existingDoc && existingDoc.opType || ADD_OP, id, type: typeConfig.type});
              })
              .then((result) => {
                  lockHandle.release();

                  if (logLevel === 'trace') {
                      console.log('Upserted doc: ', id, (performanceNow() - startTime).toFixed(3));
                  }

                  return result;
              });
        }

        return this.lock.acquire(key)
          .then(handle => {
              lockHandle = handle;

              return this.get(typeOrConfig, id);
          })
          .then((existingDoc) =>
            existingDoc
              ? this.update(typeOrConfig, id, doc, existingDoc, lockHandle)
              : this.add(typeOrConfig, doc, id, lockHandle))
          .then((result) => {
              lockHandle.release();

              return result;
          });
    }
}

//
// Exposed API
//
export default class Indexer {
    constructor(indicesConfig) {
        this.internal = new IndexerInternal(indicesConfig);
    }

    upsert(headers, request) {
        return this.internal.upsert(request.type, request.doc);
    }

    update(headers, request) {
        return this.internal.update(request.type, request.id, request.doc);
    }

    remove(headers, request) {
        return this.internal.remove(request.type, request.id);
    }

    add(headers, request) {
        return this.internal.add(request.type, request.doc);
    }

    createIndex() {
        return this.internal.createIndex();
    }

    deleteIndex() {
        return this.internal.deleteIndex();
    }

    shutdown() {
        return this.internal.shutdown();
    }

    registry() {
        return {
            upsert: {handler: this.upsert},
            update: {handler: this.update},
            remove: {handler: this.remove},
            add: {handler: this.add},
            createIndex: {handler: this.createIndex},
            deleteIndex: {handler: this.deleteIndex},
            ':type': [
                {handler: this.upsert},
                {handler: this.add, method: 'put'}
            ],
            ':type/:id': [
                {handler: this.update},
                {handler: this.remove, method: 'delete'}
            ]
        };
    }
}