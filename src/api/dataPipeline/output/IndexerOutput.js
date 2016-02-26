export default class IndexerOutput {
    constructor(config, params) {
        if (!params || !params.indexer) {
            throw new Error('Params must have indexer instance');
        }

        this.indexer = params.indexer;
        this.handler = params.indexer[config.handler];
        this.indexType = config.indexType;
    }

    handle(doc, filter) {
        return this.handler.call(this.indexer, null, {type: this.indexType, doc, filter});
    }

    shutdown() {
        return this.indexer.shutdown();
    }
}