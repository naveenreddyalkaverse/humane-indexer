import _ from 'lodash';
import Promise from 'bluebird';

import performanceNow from 'performance-now';

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

export default class DataPipelineProcessor {
    constructor(config) {
        // TODO: validate config schema with Joi
        this.config = config;
    }

    process(params) {
        const sourceHandler = Settings.source[this.config.input.source.type];
        const formatHandler = Settings.format[this.config.input.format.type];

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
            queuedCount++;

            const startTime = performanceNow();

            return Promise.resolve(outputHandler.handle(data))
              .then((result) => {
                  console.log(`Processed #${processedCount}: ${result} in ${(performanceNow() - startTime).toFixed(3)} ms`);

                  return result;
              })
              .catch(error => console.error('>>>> Error: ', error, error.stack))
              .finally(() => processedCount++);
        }));

        stream.on('end', () => {
            function shutdownIndexerIfProcessed() {
                if (queuedCount === processedCount) {
                    outputHandler.shutdown();
                } else {
                    // schedule next one
                    _.delay(shutdownIndexerIfProcessed, 5000);
                }
            }

            shutdownIndexerIfProcessed();
        });
    }
}