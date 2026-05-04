const path = require('path')
const webpack = require('webpack')
const { VueLoaderPlugin } = require('vue-loader')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin')

module.exports = {
  mode: 'development',
  entry: './example/serialization-playground.ts',
  output: {
    filename: 'serialization-playground.js',
    chunkFilename: 'serialization-playground.[name].js',
    path: path.resolve(__dirname, 'example'),
  },
  module: {
    exprContextCritical: false,
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader',
      },
      {
        test: /\.css$/,
        use: ['vue-style-loader', 'css-loader'],
      },
      {
        test: /\.ttf$/,
        use: ['file-loader'],
      },
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: {
            transpileOnly: true,
            appendTsSuffixTo: [/\.vue$/],
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
    extensions: ['.vue', '.tsx', '.ts', '.js'],
    alias: {
      perf_hooks: false,
    },
  },
  plugins: [
    new webpack.DefinePlugin({
      __VUE_OPTIONS_API__: JSON.stringify(true),
      __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
    }),
    new VueLoaderPlugin(),
    new MonacoWebpackPlugin({
      languages: ['javascript', 'typescript'],
    }),
  ],
  optimization: {
    minimize: false,
  },
  devtool: 'source-map',
  cache: false,
}
