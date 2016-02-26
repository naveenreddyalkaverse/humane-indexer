import _ from 'lodash';
import Promise from 'bluebird';
import {EventEmitter} from 'events';

import performanceNow from 'performance-now';

import watchFile from './FileWatcher';

import * as GuardedPromise from './GuardedPromise';

// inputs
import fileInput from './input/FileInput';

// formats
import jsonArrayFormat from './format/JsonArrayFormat';
import jsonFormat from './format/JsonFormat';
import logFormat from './format/LogFormat';

// mappers
import functionMapper from './mapper/FunctionMapper';

// outputs
import indexerOutput from './output/IndexerOutput';

const Settings = {
    source: {
        file: fileInput
    },
    format: {
        log: logFormat,
        json: jsonFormat,
        'json-array': jsonArrayFormat
    },
    mapper: {
        fn: functionMapper
    },
    output: {
        indexer: indexerOutput
    }
};

const PROCESS_NEXT_EVENT = 'processNext';

export default class DataPipelineProcessor {
    constructor(config) {
        // TODO: validate config schema with Joi
        this.config = config;
        this.watchQueue = [];
        this.running = false;
        this.eventEmitter = new EventEmitter();
    }

    watch(params) {
        this.eventEmitter.addListener(PROCESS_NEXT_EVENT, () => this.processWatchQueue());

        watchFile({
            filePattern: params.filePattern,
            process: path => {
                this.watchQueue.push({indexer: params.indexer, file: path, watch: true});
                this.eventEmitter.emit(PROCESS_NEXT_EVENT);
            }
        });
    }

    processWatchQueue() {
        if (this.running) return;

        this.running = true;

        const params = this.watchQueue.shift();
        if (params) {
            this.process(params);
        } else {
            this.running = false;
        }
    }

    process(params) {
        const sourceHandler = Settings.source[this.config.input.source.type];
        const formatHandler = Settings.format[this.config.input.format.type];

        console.log('Started processing: ', params.file);

        let stream = sourceHandler(this.config.input.source, params);

        stream = formatHandler(stream, this.config.input.format, params);

        if (this.config.mapper) {
            const mapperHandler = Settings.mapper[this.config.mapper.type];

            stream = mapperHandler(stream, this.config.mapper, params);
        }

        let queuedCount = 0;
        let processedCount = 0;

        const outputHandler = new (Settings.output[this.config.output.type])(this.config.output, params);

        stream.on('data', GuardedPromise.guard(this.config.output.concurrency || 1, (data) => {
            const numIndex = queuedCount++;

            const startTime = performanceNow();

            return Promise.resolve(outputHandler.handle(data, this.config.filter))
              .then((result) => {
                  console.log(`Processed #${numIndex}: ${result && (result._id || result.id)} in ${(performanceNow() - startTime).toFixed(3)} ms`);

                  return result;
              })
              .catch(error => console.error('>>>> Error: ', error, error.stack))
              .finally(() => processedCount++);
        }));

        const _this = this;

        stream.on('end', () => {
            function shutdownIndexerIfProcessed() {
                if (queuedCount === processedCount) {
                    if (!params.watch) {
                        outputHandler.shutdown();
                    } else {
                        console.log('Completed processing: ', params.file);
                        _this.running = false;
                        _this.eventEmitter.emit(PROCESS_NEXT_EVENT);
                    }
                } else {
                    // schedule next one
                    _.delay(shutdownIndexerIfProcessed, 5000);
                }
            }

            shutdownIndexerIfProcessed();
        });
    }
}