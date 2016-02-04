import Path from 'path';
import FS from 'graceful-fs';
import Promise from 'bluebird';
import JSONStream from 'JSONStream';
import EventStream from 'event-stream';

import stripBom from 'strip-bom';
import parseJson from 'parse-json';

const readFile = Promise.promisify(FS.readFile);

function parse(data, fp) {
    return parseJson(stripBom(data), Path.relative(process.cwd(), fp));
}

export default class JsonLoader {
    static load(filePath) {
        return readFile(filePath, 'utf8').then((data) => parse(data, filePath));
    }

    static loadSync(filePath) {
        return parse(FS.readFileSync(filePath, 'utf8'), filePath);
    }

    static loadStream(filePath, pattern, onData, onFinish) {
        const stream = FS.createReadStream(filePath, {flags: 'r'})
          .pipe(JSONStream.parse(pattern))
          .pipe(EventStream.map((data, cb) => cb(null, onData(data))));

        stream.on('end', onFinish);
    }
}