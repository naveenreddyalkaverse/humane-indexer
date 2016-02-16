export default class FunctionMapper extends require('stream').Transform {
    constructor(config) {
        super({objectMode: true});
        this.mapper = config.fn;
    }

    _transform(chunk, encoding, done) {
        this.push(this.mapper(chunk));

        done();
    }
}