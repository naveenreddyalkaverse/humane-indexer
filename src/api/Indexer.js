import _ from 'lodash';
import Promise from 'bluebird';
import Chalk from 'chalk';

import performanceNow from 'performance-now';

import buildRequest from 'humane-node-commons/lib/Request';

import ValidationError from 'humane-node-commons/lib/ValidationError';
import InternalServiceError from 'humane-node-commons/lib/InternalServiceError';

import Lock from './Lock';
import AggregatorCache from './AggregatorCache';

const ADD_OP = 'add';
const REMOVE_OP = 'remove';
const UPDATE_OP = 'update';

const AGGREGATE_MODE = 'aggregate';

//
// Actual implementation is in Internal class for API class to look readable and simple.
//
class IndexerInternal {
    constructor(config) {
        this.logLevel = config.logLevel || 'info';

        this.request = buildRequest(_.extend({}, config.esConfig, {logLevel: this.logLevel, baseUrl: config.esConfig && config.esConfig.url || 'http://localhost:9200'}));

        this.lock = new Lock({logLevel: this.logLevel, locksConfig: config.locksConfig, redisConfig: config.redisConfig, redisSentinelConfig: config.redisSentinelConfig});

        this.aggregatorCache = new AggregatorCache({
            logLevel: this.logLevel,
            cacheConfig: config.cacheConfig,
            redisConfig: config.redisConfig,
            redisSentinelConfig: config.redisSentinelConfig,
            instanceName: config.instanceName
        }, this, this.lock);

        // TODO: validate indices config are proper
        this.indicesConfig = config.indicesConfig;
    }

    shutdown() {
        if (this.logLevel === 'trace') {
            console.log('Shutting down: Indexer');
        }

        return Promise.resolve(this.aggregatorCache.shutdown())
          .then(() => this.lock.shutdown())
          .then(() => {
              if (this.logLevel === 'trace') {
                  console.log('Shut down: Indexer');
              }

              return true;
          });
    }

    handleResponse(response, okStatusCodes, operation) {
        if (!response) {
            return Promise.reject('ERROR: No Response');
        }

        if (_.isArray(response)) {
            response = response[0];
        }

        if (this.logLevel === 'debug' || this.logLevel === 'trace' || (response.statusCode >= 300 && (!okStatusCodes || !okStatusCodes[response.statusCode]) && response.request.method !== 'HEAD')) {
            console.log();
            console.log(Chalk.blue('------------------------------------------------------'));
            console.log(Chalk.blue.bold(`${response.request.method} ${response.request.href}`));

            const format = response.statusCode < 300 ? Chalk.green : Chalk.red;

            console.log(format(`Status: ${response.statusCode}, Elapsed Time: ${response.elapsedTime}`));

            if (response.request.method !== 'HEAD') {
                console.log(format(JSON.stringify(response.body, null, 2)));
            }

            console.log(Chalk.blue('------------------------------------------------------'));
            console.log();
        }

        if (response.statusCode < 300 || okStatusCodes && okStatusCodes[response.statusCode]) {
            return _.extend({_status: response.statusCode, _elapsedTime: response.elapsedTime, _operation: operation}, response.body);
        }

        console.error('Error in processResponse: ', response.statusCode, response.body && response.body.error);

        throw new InternalServiceError('Internal Service Error', {code: 'INTERNAL_SERVICE_ERROR'});
    }

    handleResponseArray(responses, okStatusCodes, operation) {
        return Promise
          .all(_.map(responses, response => {
              let promise = null;
              try {
                  promise = this.handleResponse(response, okStatusCodes, operation);
              } catch (error) {
                  promise = Promise.reject(error);
              }

              return promise.reflect();
          }))
          .each(inspection => {
              if (inspection.isFulfilled()) {
                  console.log('Successful Response: ', inspection.value());
              } else {
                  console.error('Error Response: ', inspection.reason());
              }
          });
    }

    typeConfig(typeOrConfig) {
        if (!typeOrConfig) {
            throw new ValidationError('Undefined Type', {code: 'UNDEFINED_TYPE'});
        }

        if (_.isString(typeOrConfig)) {
            const typeConfig = this.indicesConfig.types[typeOrConfig];
            if (!typeConfig) {
                throw new ValidationError('Unrecognized Type', {code: 'UNRECOGNIZED_TYPE', details: {type: typeOrConfig}});
            }

            return typeConfig;
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
              .then(responses => this.handleResponseArray(responses, {404: true}, 'DELETE_INDICES'));
        }

        const indexConfig = this.indicesConfig.indices[indexKey];

        return this.request({method: 'DELETE', uri: `${indexConfig.store}`})
          .then(response => this.handleResponse(response, {404: true}, 'DELETE_INDEX'));
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
                      body: {settings: {number_of_shards: 3, analysis: indexConfig.analysis}, mappings}
                  });
              })
              .value();

            return Promise.all(promises)
              .then(responses => this.handleResponseArray(responses, {404: true}, 'CREATE_INDICES'));
        }

        const indexConfig = this.indicesConfig.indices[indexKey];

        const mappings = {};

        _(this.indicesConfig.types)
          .values()
          .filter(type => type.index === indexConfig.store)
          .forEach(type => {
              mappings[type.type] = type.mapping;
          });

        return this.request({method: 'PUT', uri: `${indexConfig.store}`, body: {settings: {number_of_shards: 3, analysis: indexConfig.analysis}, mappings}})
          .then(response => this.handleResponse(response, {404: true}, 'CREATE_INDEX'));
    }

    exists(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        return this.request({method: 'HEAD', uri: `${typeConfig.index}/${typeConfig.type}/${request.id}`})
          .then(response => this.handleResponse(response, {404: true}, 'EXISTS'));
    }

    get(request) {
        let startTime = null;

        if (this.logLevel === 'trace') {
            startTime = performanceNow();
            console.log('Starting get: ', request.id);
        }

        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        const uri = `${typeConfig.index}/${typeConfig.type}/${request.id}`;

        return this.request({method: 'GET', uri})
          .then(response => this.handleResponse(response, {404: true}, 'GET'))
          .then(response => {
              const result = !!response ? response._source : null;

              if (this.logLevel === 'trace') {
                  console.log('Got: ', uri, (performanceNow() - startTime).toFixed(3));
              }

              return result;
          });
    }

    optimisedGet(request, measures) {
        let startTime = null;

        const typeConfig = this.typeConfig(request.typeConfig || request.type);

        const fields = [];

        _.forEach(measures, measureConfig => {
            let measureType = null;
            let measureName = null;
            let measureTypeConfig = null;

            if (_.isString(measureConfig)) {
                measureName = measureConfig;
                measureType = 'SUM';
            } else if (_.isObject(measureConfig)) {
                const config = _.first(_.toPairs(measureConfig));
                measureName = config[0];
                if (_.isString(config[1])) {
                    measureType = config[1];
                } else if (_.isFunction(config[1])) {
                    measureType = 'FUNCTION';
                } else if (!_.isFunction(config[1]) && _.isObject(config[1])) {
                    measureType = config[1].type;
                    measureTypeConfig = config[1];
                }
            }

            if (measureType === 'AVERAGE' || measureType === 'WEIGHTED_AVERAGE') {
                const countField = (measureType === 'AVERAGE') ? measureTypeConfig.count : measureTypeConfig.weight;
                fields.push(countField);
            }

            fields.push(measureName);

            return true;
        });

        const uri = `${typeConfig.index}/${typeConfig.type}/${request.id}`;

        if (this.logLevel === 'trace') {
            startTime = performanceNow();
            console.log('Starting get: ', uri, request.id);
        }

        return this.request({method: 'GET', uri, qs: {fields: _.join(fields, ',')}})
          .then(response => {
              let result = this.handleResponse(response, {404: true}, 'OPTIMISED_GET');

              result = !!result ? result.fields : null;

              if (result) {
                  _.forEach(fields, field => {
                      if (result[field] && _.isArray(result[field])) {
                          result[field] = result[field][0];
                      }
                  });
              }

              if (this.logLevel === 'trace') {
                  console.log('Got: ', uri, (performanceNow() - startTime).toFixed(3));
              }

              return result;
          });
    }

    buildAggregates(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        const newDoc = request.newDoc;
        const existingDoc = request.existingDoc;
        const partial = request.partial || false;

        const aggregatorsConfig = this.indicesConfig.aggregators && this.indicesConfig.aggregators[typeConfig.type];
        if (!aggregatorsConfig) {
            return false;
        }

        const promises = [];

        const buildAggregates = (aggregateConfig, doc) => {
            const aggregates = [];

            if (!doc) {
                return aggregates;
            }

            let docField = doc[aggregateConfig.field];
            if (!docField) {
                return aggregates;
            }

            if (!_.isArray(docField)) {
                docField = [docField];
            }

            _.forEach(docField, fieldValue => {
                if (!fieldValue) {
                    return true;
                }

                const aggregate = aggregateConfig.aggregateBuilder(doc, fieldValue);
                const id = _.isFunction(aggregateConfig.indexType.id) && aggregateConfig.indexType.id(aggregate) || aggregate.id;

                if (id && aggregate) {
                    aggregates.push({id, aggregate});
                }

                return true;
            });

            return aggregates;
        };

        const buildMeasures = (aggregateData, aggregateConfig, opType) => {
            const id = aggregateData.id;
            const aggregate = aggregateData.aggregate;

            const aggregateIndexConfig = aggregateConfig.indexType;
            const aggregateIndexType = aggregateIndexConfig.type;

            const key = `${aggregateIndexType}:${id}`;

            const measuresConfig = aggregateConfig.measures || aggregatorsConfig.measures;

            const operation = () =>
              Promise.resolve(this.aggregatorCache.retrieve(key))
                .then(cachedAggregateData => {
                    if (!cachedAggregateData) {
                        return this.optimisedGet({typeConfig: aggregateIndexConfig, id}, measuresConfig)
                          .then(result => (result && {doc: result, opType, id, type: aggregateIndexType} || null));
                    }

                    return cachedAggregateData;
                })
                .then(existingAggregateData => {
                    if (!existingAggregateData) {
                        if (opType === UPDATE_OP) {
                            opType = ADD_OP;
                        } else if (opType === REMOVE_OP) {
                            // if it does not exist what to remove ?
                            return true;
                        }
                    }

                    let existingAggregateDoc = null;
                    let newAggregateDoc = {};

                    // aggregate already exist
                    if (existingAggregateData && existingAggregateData.doc) {
                        existingAggregateDoc = existingAggregateData.doc;
                        newAggregateDoc = _.extend(newAggregateDoc, existingAggregateDoc, aggregate);
                    } else {
                        existingAggregateDoc = {};
                        newAggregateDoc = _.extend(newAggregateDoc, aggregate);
                    }

                    _.forEach(measuresConfig, measureConfig => {
                        let measureType = null;
                        let measureName = null;
                        let measureFunction = null;
                        let measureTypeConfig = null;

                        if (_.isString(measureConfig)) {
                            measureName = measureConfig;
                            measureType = 'SUM';
                        } else if (_.isObject(measureConfig)) {
                            const config = _.first(_.toPairs(measureConfig));
                            measureName = config[0];
                            if (_.isString(config[1])) {
                                measureType = config[1];
                            } else if (_.isFunction(config[1])) {
                                measureType = 'FUNCTION';
                                measureFunction = config[1];
                            } else if (_.isObject(config[1])) {
                                measureType = config[1].type;
                                measureTypeConfig = config[1];
                            }
                        }

                        if (partial && _.isUndefined(newDoc[measureName])) {
                            // we skip if new doc does not have value in case of partial update
                            return true;
                        }

                        let value = _.get(existingAggregateDoc, measureName, 0);

                        if (measureType === 'COUNT') {
                            if (opType === ADD_OP) {
                                // simply SUM the values here
                                value += 1;
                            } else if (opType === REMOVE_OP) {
                                // simply REDUCE the values here
                                value -= 1;
                            }
                        } else if (measureType === 'SUM') {
                            if (opType === ADD_OP) {
                                value += _.get(newDoc, measureName, 0);
                            } else if (opType === UPDATE_OP) {
                                value += (_.get(newDoc, measureName, 0) - _.get(existingDoc, measureName, 0));
                            } else if (opType === REMOVE_OP) {
                                // simply REDUCE the values here
                                value -= _.get(existingDoc, measureName, 0);
                            }
                        } else if (measureType === 'AVERAGE' || measureType === 'WEIGHTED_AVERAGE') {
                            let totalCount = 0;
                            let totalValue = 0;

                            const countField = (measureType === 'AVERAGE') ? measureTypeConfig.count : measureTypeConfig.weight;

                            value = value * _.get(existingAggregateDoc, measureTypeConfig.count, 0);
                            if (opType === ADD_OP) {
                                totalCount = _.get(existingAggregateDoc, countField, 0) + _.get(newDoc, countField, 0);
                                totalValue = value + _.get(newDoc, measureName, 0) * _.get(newDoc, countField, 0);
                            } else if (opType === UPDATE_OP) {
                                totalCount = _.get(existingAggregateDoc, countField, 0) - _.get(existingDoc, countField, 0) + _.get(newDoc, countField, 0);
                                totalValue = value - _.get(existingDoc, measureName, 0) * _.get(existingDoc, countField, 0) + _.get(newDoc, measureName, 0) * _.get(newDoc, countField, 0);
                            } else if (opType === REMOVE_OP) {
                                totalCount = _.get(existingAggregateDoc, countField, 0) - _.get(existingDoc, countField, 0);
                                totalValue = value - _.get(existingDoc, measureName, 0) * _.get(existingDoc, countField, 0);
                            }

                            value = _.round(totalCount > 0 ? totalValue / totalCount : 0, measureTypeConfig.round || 3);
                        } else if (measureType === 'FUNCTION') {
                            value = measureFunction(newAggregateDoc, opType);

                            const modifier = measureTypeConfig && measureTypeConfig.modifier || 'log1p';
                            if (modifier) {
                                value = _.invoke(Math, 'log1p', value);
                            }

                            value = _.round(value, measureTypeConfig && measureTypeConfig.round || 3);
                        }

                        newAggregateDoc[measureName] = value;

                        return true;
                    });

                    return this.aggregatorCache.store(key, {doc: newAggregateDoc, existingDoc: existingAggregateDoc, opType, id, type: aggregateIndexType});
                });

            const promise = this.lock.usingLock(operation, key);

            promises.push(promise);
        };

        _(aggregatorsConfig.aggregates)
          .values()
          .forEach((aggregateConfig) => {
              const newDocAggregates = buildAggregates(aggregateConfig, newDoc);
              const existingDocAggregates = buildAggregates(aggregateConfig, existingDoc);

              const aggregatesToAdd = []; // if in newDoc, but not in existingDoc
              const aggregatesToRemove = []; // if not in newDoc, but in existingDoc
              const aggregatesToUpdate = []; // if in both newDoc and existingDoc

              _.forEach(newDocAggregates, newDocAggregate => {
                  let found = false;
                  _.forEach(existingDocAggregates, existingDocAggregate => {
                      if (newDocAggregate.id === existingDocAggregate.id) {
                          found = true;
                          return false;
                      }

                      return true;
                  });

                  if (found) {
                      aggregatesToUpdate.push(newDocAggregate);
                  } else {
                      aggregatesToAdd.push(newDocAggregate);
                  }
              });

              _.forEach(existingDocAggregates, existingDocAggregate => {
                  let found = false;
                  _.forEach(newDocAggregates, newDocAggregate => {
                      if (newDocAggregate.id === existingDocAggregate.id) {
                          found = true;
                          return false;
                      }

                      return true;
                  });

                  if (!found && !partial) {
                      aggregatesToRemove.push(existingDocAggregate);
                  }
              });

              _.forEach(aggregatesToAdd, aggregateData => buildMeasures(aggregateData, aggregateConfig, ADD_OP));
              _.forEach(aggregatesToRemove, aggregateData => buildMeasures(aggregateData, aggregateConfig, REMOVE_OP));
              _.forEach(aggregatesToUpdate, aggregateData => buildMeasures(aggregateData, aggregateConfig, UPDATE_OP));
          });

        return Promise.all(promises).then((responses) => _.every(responses, response => !!response));
    }

    flushAggregate(key) {
        console.log(Chalk.yellow(`Flushing Key: ${key}`));

        const operation = (lockHandle) =>
          Promise.resolve(this.aggregatorCache.retrieve(key))
            .then(cachedAggregate => {
                if (!cachedAggregate) {
                    return null;
                }

                const {doc, type, id} = cachedAggregate;

                if (cachedAggregate.opType !== ADD_OP) {
                    return this.update({type, id, doc, existingDoc: cachedAggregate.existingDoc, lockHandle});
                }

                //console.log('Flushing: ', doc);
                return this.add({type, doc, id, lockHandle});
            })
            .then(() => this.aggregatorCache.remove(key));

        return this.lock.usingLock(operation, key, null, timeTaken => console.log(Chalk.yellow(`Flushed Key: ${key} in ${timeTaken}ms`)));
    }

    add(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        const transform = typeConfig.transform;

        const doc = request.doc;
        if (transform && _.isFunction(transform)) {
            transform(doc);
        }

        if (request.filter && _.isFunction(request.filter) && !request.filter(doc)) {
            return false;
        }

        if (typeConfig.filter && _.isFunction(typeConfig.filter) && !typeConfig.filter(doc)) {
            return false;
        }

        if (typeConfig.weight && _.isFunction(typeConfig.weight)) {
            doc.weight = _.round(Math.log1p(typeConfig.weight(doc)), 3);
        }

        const id = request.id || typeConfig.id(doc);

        let result = null;

        const operation = () =>
          this.request({method: 'PUT', uri: `${typeConfig.index}/${typeConfig.type}/${id}`, body: doc})
            .then(response => this.handleResponse(response, {404: true}, 'ADD'))
            .then(response => {
                result = response;

                return this.buildAggregates({typeConfig, newDoc: doc});
            })
            .then(() => _.pick(result, ['_id', '_type', '_index', '_version', '_status', '_operation']));

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, request.lockHandle, timeTaken => console.log(Chalk.blue(`Added ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    remove(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);

        const id = request.id;
        let existingDoc = request.doc;

        let result = null;

        const operation = () =>
          Promise.resolve(existingDoc || this.get({typeConfig, id}))
            .then(response => {
                existingDoc = response;
                return response;
            })
            .then(() => {
                if (!existingDoc) {
                    return {_id: id, _type: typeConfig.type, _index: typeConfig.index, found: false, _status: 404};
                }

                return this.request({method: 'DELETE', uri: `${typeConfig.index}/${typeConfig.type}/${id}`})
                  .then(response => this.handleResponse(response, {404: true}, 'REMOVE'))
                  .then(response => {
                      result = response;

                      return this.buildAggregates({typeConfig, existingDoc, partial: request.partial});
                  })
                  .then(() => _.pick(result, ['_id', '_type', '_index', '_version', 'found', '_status', '_operation']));
            });

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, request.lockHandle, timeTaken => console.log(Chalk.red(`Removed ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    update(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        const transform = typeConfig.transform;

        const newDoc = request.doc;
        let existingDoc = request.existingDoc;
        if (transform && _.isFunction(transform)) {
            transform(newDoc);
        }

        if (typeConfig.weight && _.isFunction(typeConfig.weight)) {
            newDoc.weight = _.round(Math.log1p(typeConfig.weight(newDoc)), 3);
        }

        const id = request.id || typeConfig.id(newDoc);

        let result = null;

        const operation = () =>
            // TODO: fields for filter, aggregate, measures
            // TODO: in case of partial update, fetch only fields part of the to be updated document, filter, aggregate, measures
          Promise.resolve(existingDoc || this.get({typeConfig, id}))
            .then(response => {
                existingDoc = response;
                return response;
            })
            .then(() => {
                if (!existingDoc) {
                    return {_id: id, _type: typeConfig.type, _index: typeConfig.index, found: false, _status: 404, _operation: request.partial ? 'PARTIAL_UPDATE' : 'UPDATE'};
                }

                if (request.filter && _.isFunction(request.filter) && !request.filter(newDoc, existingDoc)) {
                    // if it is filtered by type then remove
                    if (typeConfig.filter && _.isFunction(typeConfig.filter) && !typeConfig.filter(newDoc, existingDoc)) {
                        return this.remove({typeConfig, id, doc: existingDoc, lockHandle: request.lockHandle, partial: request.partial});
                    }

                    // more of a partial update
                    return {_id: id, _type: typeConfig.type, _index: typeConfig.index, found: true, _skip: true, _status: 404, _operation: request.partial ? 'PARTIAL_UPDATE' : 'UPDATE'};
                }

                if (typeConfig.filter && _.isFunction(typeConfig.filter) && !typeConfig.filter(newDoc, existingDoc)) {
                    return this.remove({typeConfig, id, doc: existingDoc, lockHandle: request.lockHandle, partial: request.partial});
                }

                return this.request({method: 'POST', uri: `${typeConfig.index}/${typeConfig.type}/${id}/_update`, body: {doc: newDoc}})
                  .then(response => this.handleResponse(response, {404: true}, request.partial ? 'PARTIAL_UPDATE' : 'UPDATE'))
                  .then(response => {
                      result = response;

                      return this.buildAggregates({typeConfig, newDoc, existingDoc, partial: request.partial});
                  })
                  .then(() => _.pick(result, ['_id', '_type', '_index', '_version', '_status', '_operation']));
            });

        return this.lock.usingLock(operation, `${typeConfig.type}:${id}`, request.lockHandle, timeTaken => console.log(Chalk.green(`Updated ${typeConfig.type} #${id} in ${timeTaken}ms`)));
    }

    partialUpdate(request) {
        return this.update(_.extend(request, {partial: true}));
    }

    upsert(request) {
        const typeConfig = this.typeConfig(request.typeConfig || request.type);
        const doc = request.doc;

        const mode = typeConfig.mode;

        const id = typeConfig.id(doc);

        const key = `${typeConfig.type}:${id}`;

        let operation = null;

        // for now upsert operation is the only supported for aggregate mode
        if (mode && mode === AGGREGATE_MODE) {
            operation = () => {
                let startTime = null;

                if (this.logLevel === 'trace') {
                    startTime = performanceNow();
                    console.log('Starting aggregate upsert: ', key);
                }

                return Promise.resolve(this.aggregatorCache.retrieve(key))
                  .then(cachedAggregateData => {
                      if (!cachedAggregateData) {
                          return this.optimisedGet({typeConfig, id}, typeConfig.measures)
                            .then(result => (result && {doc: result, opType: UPDATE_OP, id, type: typeConfig.type} || null));
                      }

                      return cachedAggregateData;
                  })
                  .then(existingAggregateData => {
                      const opType = existingAggregateData && existingAggregateData.opType || ADD_OP;

                      const aggregateDoc = typeConfig.aggregateBuilder(existingAggregateData && existingAggregateData.doc, doc);

                      const measuresConfig = typeConfig.measures;

                      let existingAggregateDoc = null;
                      let newAggregateDoc = {};

                      // aggregate already exist
                      if (existingAggregateData && existingAggregateData.doc) {
                          existingAggregateDoc = existingAggregateData.doc;
                          newAggregateDoc = _.extend(newAggregateDoc, existingAggregateDoc, aggregateDoc);
                      } else {
                          existingAggregateDoc = {};
                          newAggregateDoc = _.extend(newAggregateDoc, aggregateDoc);
                      }

                      _.forEach(measuresConfig, measureConfig => {
                          let measureType = null;
                          let measureName = null;
                          let measureFunction = null;
                          let measureTypeConfig = null;

                          if (_.isString(measureConfig)) {
                              measureName = measureConfig;
                              measureType = 'SUM';
                          } else if (_.isObject(measureConfig)) {
                              const config = _.first(_.toPairs(measureConfig));
                              measureName = config[0];
                              if (_.isString(config[1])) {
                                  measureType = config[1];
                              } else if (_.isFunction(config[1])) {
                                  measureType = 'FUNCTION';
                                  measureFunction = config[1];
                              } else if (_.isObject(config[1])) {
                                  measureType = config[1].type;
                                  measureTypeConfig = config[1];
                              }
                          }

                          if (request.partial && _.isUndefined(doc[measureName])) {
                              // we skip if new doc does not have value in case of partial update
                              return true;
                          }

                          let value = _.get(existingAggregateDoc, measureName, 0);

                          if (measureType === 'COUNT') {
                              value += 1;
                          } else if (measureType === 'SUM') {
                              value += _.get(doc, measureName, 0);
                          } else if (measureType === 'AVERAGE' || measureType === 'WEIGHTED_AVERAGE') {
                              const countField = (measureType === 'AVERAGE') ? measureTypeConfig.count : measureTypeConfig.weight;

                              const totalValue = value * _.get(existingAggregateDoc, countField, 0) + _.get(doc, measureName, 0) * _.get(doc, countField, 0);
                              const totalCount = _.get(existingAggregateDoc, countField, 0) + _.get(doc, countField, 0);

                              value = _.round(totalCount > 0 ? totalValue / totalCount : 0, measureTypeConfig.round || 3);
                          } else if (measureType === 'FUNCTION') {
                              value = measureFunction(newAggregateDoc, opType);

                              const modifier = measureTypeConfig && measureTypeConfig.modifier || 'log1p';
                              if (modifier) {
                                  value = _.invoke(Math, 'log1p', value);
                              }

                              value = _.round(value, measureTypeConfig && measureTypeConfig.round || 3);
                          }

                          newAggregateDoc[measureName] = value;

                          return true;
                      });

                      if (this.logLevel === 'trace') {
                          console.log('Aggregation time: ', key, (performanceNow() - startTime).toFixed(3));
                      }

                      return this.aggregatorCache.store(key, {doc: newAggregateDoc, existingDoc: existingAggregateDoc, opType, id, type: typeConfig.type});
                  })
                  .then(() => {
                      if (this.logLevel === 'trace') {
                          console.log('Finished aggregate upsert: ', key, (performanceNow() - startTime).toFixed(3));
                      }

                      return {_status: 200, _id: id, _type: typeConfig.type, _index: typeConfig.index, _operation: 'LAZY_AGGREGATE'};
                  });
            };

            return this.aggregatorCache.ensureFlushComplete()
              .then(() =>
                this.lock.usingLock(operation, key, null, (timeTaken) => console.log(Chalk.magenta(`Upserted ${typeConfig.type} #${id} in ${timeTaken}ms`))));
        }

        operation = (lockHandle) =>
          Promise.resolve(this.get({typeConfig, id}))
            .then((existingDoc) => existingDoc ? this.update({typeConfig, id, doc, existingDoc, lockHandle}) : this.add({typeConfig, doc, id, lockHandle}));

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

    errorWrap(promise) {
        return Promise.resolve(promise)
          .catch(error => {
              if (error && (error.name === 'ValidationError' || error.name === 'InternalServiceError')) {
                  // rethrow same error
                  throw error;
              }

              console.error('Internal Service Error: ', error, error && error.stack);
              throw new InternalServiceError('Internal Service Error', {code: 'INTERNAL_SERVICE_ERROR'});
          });
    }

    upsert(headers, request) {
        return this.errorWrap(this.internal.upsert(request));
    }

    update(headers, request) {
        return this.errorWrap(this.internal.update(request));
    }

    partialUpdate(headers, request) {
        return this.errorWrap(this.internal.partialUpdate(request));
    }

    remove(headers, request) {
        return this.errorWrap(this.internal.remove(request));
    }

    add(headers, request) {
        return this.errorWrap(this.internal.add(request));
    }

    createIndex(indexKey) {
        return this.errorWrap(this.internal.createIndex(indexKey));
    }

    deleteIndex(indexKey) {
        return this.errorWrap(this.internal.deleteIndex(indexKey));
    }

    shutdown() {
        return this.internal.shutdown();
    }

    registry() {
        return {
            upsert: {handler: this.upsert},
            update: {handler: this.update},
            partialUpdate: {handler: this.partialUpdate},
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