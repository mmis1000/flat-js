
const path = require('path')

const original = require('./webpack.config')

module.exports = {
  ...original,
  mode: 'development',
  devServer: {
    contentBase: path.join(__dirname, 'dist-web'),
    compress: true,
    port: 9000
  }
}
