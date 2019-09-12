var fs = require('fs');
var IRs = fs.readdirSync(__dirname);

IRs.forEach(function(name) {
  if (name !== 'index.js' && name[0] !== '.') {
    module.exports[name.split('.')[0]] = require('./' + name)
  }
})