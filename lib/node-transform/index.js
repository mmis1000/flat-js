module.exports = function () {
  var actions = {}
  var LVal_actions = {}
  var ir = require("./ir")
  var fs = require('fs');
  var passes = fs.readdirSync(__dirname);
  
  
  passes.forEach(function(name) {
    if (name !== 'index.js' && name.match(/\.js$/)) {
      if (name.match((/^LVal/))) {
        LVal_actions[name.split('.')[0].replace(/^LVal/, '')] = require('./' + name)
      } else {
        actions[name.split('.')[0]] = require('./' + name)
      }
    }
  })
  
  function transform(node) {
    var list;
    if (actions[node.type]) {
      list = actions[node.type](node, ir, transform)
    } else {
      throw new Error(`unknown type ${node.type}`);
    }
    return list;
  }
  
  transform.l = function LValTransform(node) {
    var list;
    if (LVal_actions[node.type]) {
      list = LVal_actions[node.type](node, ir, transform)
    } else {
      throw new Error(`unknown LVal type ${node.type}`);
    }
    return list;
  }
  
  return transform
} ();