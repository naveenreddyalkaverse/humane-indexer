import _ from 'lodash';

import {Command} from 'cli-boilerplate/lib/CliBuilder';

import DataPipelineProcessor from './dataPipeline/DataPipelineProcessor';

export default function (indexerBuilder, dataPipelineConfig) {
    _(dataPipelineConfig)
      .keys()
      .forEach(importKey => {
          const name = _.upperFirst(_.camelCase(importKey));

          const importConfig = dataPipelineConfig[importKey];

          const sourceType = importConfig.input.source.type;
          const sourceFormat = importConfig.input.format.type;

          if (sourceType === 'file') {
              new Command(`import${name}`)
                .option(`-i, --file <${importKey}-file-path>`, `File path for ${importKey} in ${sourceFormat} format`)
                .description(`Imports ${importKey} that are in ${sourceFormat} format`)
                .action(
                  args => new DataPipelineProcessor(importConfig).process({file: args.file, indexer: indexerBuilder()}),
                  {watch: true, memorySize: importConfig.output.memorySize, gcInterval: importConfig.output.gcInterval}
                );
          }
      });
}