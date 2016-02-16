import LineSeparatorTransform from './../transforms/LineSeparatorTransform';
import LogTransform from './../transforms/LogTransform';

export default function (stream, config) {
    return stream.pipe(new LineSeparatorTransform())
      .pipe(new LogTransform({regex: config.regex, fields: config.fields, transform: config.transform}));
}