const HtmlWebpackPlugin = require('html-webpack-plugin')
const VueLoaderPlugin = require('vue-loader/lib/plugin')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const path = require('path')

module.exports = {
  mode: 'production',
  entry: './web/index.ts',
  module: {
    rules: [
      {
        test: /\.vue$/,
        loader: 'vue-loader'
      },
      {
        test: /\.css$/,
        use: [
          'vue-style-loader',
          'css-loader'
        ]
      },
      {
        test: /\.ttf$/,
        use: ['file-loader']
      },
      {
        test: /\.tsx?$/,
        use: {
          loader: 'ts-loader',
          options: { appendTsSuffixTo: [/\.vue$/] },
        },
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(__dirname, 'web/index.html')
    }),
    new MonacoWebpackPlugin(),
    new VueLoaderPlugin()
  ],
  optimization: {
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_debugger: false
          }
        },
      }),
    ],
  },
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist-web')
  },
  devtool: 'source-map'
}
