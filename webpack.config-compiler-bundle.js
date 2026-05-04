const path = require('path')

module.exports = {
  mode: 'development',
  target: 'node',
  entry: './lib/compiler.js',
  output: {
    filename: 'compiler-with-typescript.cjs',
    library: {
      type: 'commonjs2',
    },
    path: path.resolve(__dirname, 'lib'),
  },
  resolve: {
    extensions: ['.js'],
  },
  optimization: {
    minimize: false,
  },
  devtool: false,
  cache: false,
}
