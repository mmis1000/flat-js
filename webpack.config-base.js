const HtmlWebpackPlugin = require('html-webpack-plugin')
const VueLoaderPlugin = require('vue-loader/lib/plugin')
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const path = require('path')
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = (dev = false) => ({
    mode: dev
      ?'development'
      :'production',
    entry: './web/index.ts',
    module: {
      exprContextCritical: false,
      rules: [
        {
          test: /\.vue$/,
          loader: 'vue-loader'
        },
        {
          test: /\.css$/,
          use: [
            dev
              ? 'vue-style-loader'
              : MiniCssExtractPlugin.loader,
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
            options: {
              transpileOnly: dev,
              appendTsSuffixTo: [/\.vue$/]
            },
          },
          exclude: /node_modules/
        }
      ]
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
        'perf_hooks': false
      }
    },
    plugins: [
      new VueLoaderPlugin(),
      ...(dev ? [] : [new MiniCssExtractPlugin()]),
      new HtmlWebpackPlugin({
        template: path.join(__dirname, 'web/index.html')
      }),
      new MonacoWebpackPlugin({
        languages: ['javascript', 'typescript']
      }),
    ],
    ...(dev 
      ? {}
      : {
        optimization: {
          splitChunks: {
            chunks: 'all',
            cacheGroups: {
              monacoCommon: {
                test: /[\\/]node_modules[\\/]monaco\-editor/,
                name: 'monaco-editor-common',
                reuseExistingChunk: true
              },
              typescript: {
                test: /[\\/]node_modules[\\/]typescript/,
                name: 'typescript',
                reuseExistingChunk: true
              }
            }
          },
          runtimeChunk: {
            name: (entrypoint) => `runtime~${entrypoint.name}`,
          },
          minimizer: [
            new TerserPlugin({
              terserOptions: {
                compress: {
                  drop_debugger: false
                }
              },
            }),
          ],
        }
      }
    ),
    cache: {
      type: 'filesystem',
      cacheDirectory: path.resolve(__dirname, '.temp_cache'),
    },
    output: {
      filename: '[name].[contenthash:8].js',
      chunkFilename: '[id].[chunkhash:8].js',
      path: path.resolve(__dirname, 'dist-web'),
      clean: true,
    },
    devtool: 'source-map',
    devServer: {
      contentBase: path.join(__dirname, 'dist-web'),
      compress: true,
      port: 9000
    }
})