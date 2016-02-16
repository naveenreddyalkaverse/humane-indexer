import LineSeparatorTransform from './../transforms/LineSeparatorTransform';

export default function (stream, config) {
    return stream.pipe(new LineSeparatorTransform({jsonParse: true}));
}