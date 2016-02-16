import _ from 'lodash';
import Config from 'config';
import Agent from 'agentkeepalive';
import Promise from 'bluebird';
import Request from 'request';
import Chalk from 'chalk';

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
        if (logLevel === 'trace') {
            console.log('Shutting down: Indexer');
        }

        return Promise.resolve(this.aggregatorCache.shutdown())
          .then(() => this.lock.shutdown())
          .then(() => {
              if (logLevel === 'trace') {
                  console.log('Shut down: Indexer');
              }

              return true;
          });
    }

    static handleResponse(response, okStatusCodes) {
        if (!response) {
            return Promise.reject('ERROR: No Response');
        }

        if (_.isArray(response)) {
            response = response[0];
        }

        if (logLevel === 'debug' || (response.statusCode >= 300 && (!okStatusCodes || !okStatusCodes[response.statusCode]) && response.request.method !== 'HEAD')) {
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

        if (response.statusCode < 300) {
            return Promise.resolve(response.body);
        } else if (okStatusCodes && okStatusCodes[response.statusCode]) {
            return Promise.resolve(null);
        }

        return Promise.reject(response.body);
    }

    static handleResponseArray(responses, okStatusCodes) {
        const finalResponses = [];

        let fail = false;
        _.forEach(responses, response =>
          Promise.resolve(IndexerInternal.handleResponse(response, okStatusCodes))
            .then(result => {
                console.log('Pushing success: ', result);
                finalResponses.push(result);
            })
            .catch(error => {
                console.log('Pushing error: ', error);
                finalResponses.push(error);
                fail = true;
            }));

        if (fail) {
            return Promise.reject(finalResponses);
        }

        return Promise.resolve(finalResponses);
    }

    typeConfig(typeOrConfig) {
        if (_.isString(typeOrConfig)) {
            return this.indicesConfig.types[typeOrConfig];
        }

        return typeOrConfig;
    }

    deleteIndex(indexKey) {
        if (!indexKey) {
            const promises = _(this.indicesConfig.indices)
              .values()
              .map((indexConfig) => this.request({method: 'DELETE', uri: `${indexConfig.store}`}))
              .value();

            return Promise.all(promises)
              .then(responses => IndexerInternal.handleResponseArray(responses));
        }

        const indexConfig = this.indicesConfig.indices[indexKey];

        return this.request({method: 'DELETE', uri: `${indexConfig.store}`})
          .then(IndexerInternal.handleResponse);
    }

    createIndex(indexKey) {
        if (!indexKey) {
            const promises = _(this.indicesConfig.indices)
              .values()
              .map((indexConfig) => {
                  const mappings = {};

                  _(this.indicesConfig.types)
                    .values()
                    .filter(type => type.index === indexConfig.store)
                    .forEach(type => {
                        mappings[type.type] = type.mapping;
                    });

                  return this.request({
                      method: 'PUT',
                      uri: `${indexConfig.store}`,
                      body: {settings: {analysis: indexConfig.analysis}, mappings}
                  });
              })
              .value();

            return Promise.all(promises)
              .then(responses => IndexerInternal.handleResponseArray(responses));
        }

        const indexConfig = this.indicesConfig.indices[indexKey];

        const mappings = {};

        _(this.indicesConfig.types)
          .values()
          .filter(type => type.index === indexConfig.store)
          .forEach(type => {
              mappings[type.type] = type.mapping;
          });

        return this.request({method: 'PUT', uri: `${indexConfig.store}`, body: {settings: {analysis: indexConfig.analysis}, mappings}})
          .then(IndexerInternal.handleResponse);
    }

    exists(typeOrConfig, id) {
        const typeConfig = this.typeConfig(typeOrConfig);
        return this.request({method: 'HEAD', uri: `${typeConfig.index}/${typeConfig.type}/${id}`})
          .then(response => IndexerInternal.handleResponse(response, {404: true}));
    }

    get(typeOrConfig, id) {
        const typeConfig = this.typeConfig(typeOrConfig);
        return this.request({method: 'GET', uri: `${typeConfig.index}/${typeConfig.type}/${id}`})
          .then(response => IndexerInternal.handleResponse(response, {404: true}))
          .then((response) => (response || {})._source || null);
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

            const key = `${typeConfig.type}:${id}`;

            const operation = () =>
              Promise.resolve(this.aggregatorCache.retrieve(key))
                .then(cachedFieldDoc => {
                    if (!cachedFieldDoc) {
                        return this.get(typeConfig, id)
                          .then(result => (result && {doc: result, opType, id, type: typeConfig.type} || null));
                    }

                    return cachedFieldDoc;
                })
                .then(existingFieldDoc => {
                    const aggregates = aggregateConfig.aggregateBuilder(
                      existingFieldDoc && existingFieldDoc.doc,
                      opType !== ADD_OP ? existingMeasures : null,
                      opType === REMOVE_OP ? null : newMeasures);
                    const newFieldDoc = _.extend(existingFieldDoc && existingFieldDoc.doc || {}, data, aggregates);

                    return this.aggregatorCache.store(key, {doc: newFieldDoc, opType, id, type: typeConfig.type});
                });

            const promise = this.lock.usingLock(operation, key);

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
        let finalResult = null;

        console.log(Chalk.yellow(`Flushing Key: ${key}`));

        const operation = (lockHandle) =>
          Promise.resolve(this.aggregatorCache.retrieve(key))
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
                finalResult = result;
                if (result) {
                    return this.aggregatorCache.remove(key);
                }

                return finalResult;
            });

        return this.lock.usingLock(operation, key, null, timeTaken => console.log(Chalk.yellow(`Flushed Key: ${key} in ${timeTaken}ms`)));
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
            .then(IndexerInternal.handleResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, doc);
            })
            .then(() => result);

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, lockHandle, timeTaken => console.log(Chalk.blue(`Added ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    remove(typeOrConfig, id, existingDoc, lockHandle) {
        const typeConfig = this.typeConfig(typeOrConfig);

        let result = null;

        const operation = () =>
          Promise.resolve(existingDoc || this.get(typeOrConfig, id))
            .then(response => existingDoc = response)
            .then(() => this.request({method: 'DELETE', uri: `${typeConfig.index}/${typeConfig.type}/${id}`}))
            .then(IndexerInternal.handleResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, null, existingDoc);
            })
            .then(() => result);

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, lockHandle, timeTaken => console.log(Chalk.red(`Removed ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    update(typeOrConfig, id, newDoc, existingDoc, lockHandle) {
        const typeConfig = this.typeConfig(typeOrConfig);
        const transform = typeConfig.transform;
        if (transform && _.isFunction(transform)) {
            transform(newDoc);
        }

        id = id || typeConfig.id(newDoc);

        let result = null;

        const filter = typeConfig.filter;
        if (filter && _.isFunction(filter) && !filter(newDoc)) {
            return this.remove(typeOrConfig, id, existingDoc, lockHandle);
        }

        const operation = () =>
          Promise.resolve(existingDoc || this.get(typeOrConfig, id))
            .then(response => existingDoc = response)
            .then(() => this.request({method: 'POST', uri: `${typeConfig.index}/${typeConfig.type}/${id}/_update`, body: {doc: newDoc}}))
            .then(IndexerInternal.handleResponse)
            .then(response => {
                result = response;

                return this.buildAggregates(typeOrConfig, newDoc, existingDoc);
            })
            .then(() => result);

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, lockHandle, timeTaken => console.log(Chalk.green(`Updated ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    upsert(typeOrConfig, doc) {
        const typeConfig = this.typeConfig(typeOrConfig);

        const mode = typeConfig.mode;

        const id = typeConfig.id(doc);

        const key = `${typeConfig.type}:${id}`;

        let operation = null;

        // for now upsert operation is the only supported for aggregate mode
        if (mode && mode === AGGREGATE_MODE) {
            operation = () =>
              Promise.resolve(this.aggregatorCache.retrieve(key))
                .then(cachedDoc => {
                    if (!cachedDoc) {
                        return this.get(typeConfig, id)
                          .then(result => (result && {doc: result, opType: UPDATE_OP, id, type: typeConfig.type} || null));
                    }

                    return cachedDoc;
                })
                .then(existingDoc => {
                    const newDoc = typeConfig.aggregateBuilder(existingDoc && existingDoc.doc, doc);

                    return this.aggregatorCache.store(key, {doc: newDoc, opType: existingDoc && existingDoc.opType || ADD_OP, id, type: typeConfig.type});
                });
        } else {
            operation = (lockHandle) =>
              Promise.resolve(this.get(typeOrConfig, id))
                .then((existingDoc) => existingDoc ? this.update(typeOrConfig, id, doc, existingDoc, lockHandle) : this.add(typeOrConfig, doc, id, lockHandle));
        }

        return this.lock.usingLock(operation, key, null, (timeTaken) => console.log(Chalk.magenta(`Upserted ${typeConfig.type} #${id} in ${timeTaken}ms`)));
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

    createIndex(indexKey) {
        return this.internal.createIndex(indexKey);
    }

    deleteIndex(indexKey) {
        return this.internal.deleteIndex(indexKey);
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