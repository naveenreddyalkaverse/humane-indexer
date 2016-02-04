import _ from 'lodash';
const decoder = new (require('string_decoder')).StringDecoder('utf8');

export default class LineSeparatorTransform extends require('stream').Transform {
    constructor(options) {
        super(options);
        this._buffer = '';
        this._separator = (options && options.separator) || /\r\n|\r|\n/g;
        this._flushTail = (options && options.flushTail || true);
    }

    _transform(chunk, encoding, done) {
        const str = this._buffer + decoder.write(chunk);
        const list = str.split(this._separator);

        let remaining = null;
        if (list.length >= 1) {
            remaining = list.pop();
        } else {
            // we could not split it...
            remaining = str;
        }

        for (let i = 0; i < list.length; i++) {
            this.push(_.trim(list[i]));
        }

        this._buffer = remaining || '';

        done();
    }

    _flush(done) {
        if (this._flushTail) {
            this.push(_.trim(this._buffer));
        }

        done();
    }
}