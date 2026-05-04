const path = require('path')

module.exports = {
  mode: 'development',
  entry: './example/serialization-playground.ts',
  output: {
    filename: 'serialization-playground.js',
    path: path.resolve(__dirname, 'example'),
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            compilerOptions: {
              ignoreDeprecations: '6.0',
            },
          },
        },
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      perf_hooks: false,
    },
  },
  optimization: {
    minimize: false,
  },
  devtool: 'source-map',
  cache: false,
}
