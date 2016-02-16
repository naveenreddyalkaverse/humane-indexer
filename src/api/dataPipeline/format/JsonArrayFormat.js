import JsonTransform from './../transforms/JsonTransform';
import ArrayTransform from './../transforms/ArrayTransform';

export default function (stream, config) {
    return stream.pipe(new JsonTransform({path: config.jsonPath}))
      .pipe(new ArrayTransform());
}