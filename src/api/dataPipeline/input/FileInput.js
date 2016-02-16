import FS from 'graceful-fs';
import Zlib from 'zlib';

export default function (source, params) {
    if (!params || !params.file) {
        throw new Error('Params must have file path!');
    }

    const stream = FS.createReadStream(params.file, {flags: 'r'});

    if (source.gzip) {
        return stream.pipe(Zlib.createGunzip({flush: 1, end: false, chunkSize: 1024 * 1024}));
    }

    return stream;
}