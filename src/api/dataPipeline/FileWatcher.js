import FileStorage from '../../../node_modules/lowdb/file-sync';
import Chokidar from 'chokidar';

import lowDB from 'lowdb';
import md5 from 'md5';

// db file
export default function (args) {
    const db = lowDB(args.db, {storage: FileStorage});

    const watcher = Chokidar.watch(args.filePattern || '.', {
        persistent: true, // watch files in daemon mode
        cwd: args.cwd || '.',
        depth: args.depth || 1, // depth
        awaitWriteFinish: {
            stabilityThreshold: 5000,
            pollInterval: 1000
        }
    });

    watcher.on('add', (path, stats) => {
        // check file does not exist in db
        // if exists, skip it
        const id = md5(path);
        if (!db('files').find({id})) {
            // else, add the file and call the callback
            db('files').push({id, path, time: Date.now()});

            // TODO: enqueue file in a job queue instead of calling process directly
            args.process(path, stats);
        }
    });
}
