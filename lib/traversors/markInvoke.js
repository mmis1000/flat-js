module.exports = function (t) {
  var markInvoke = {
    CallExpression(path) {
      if (path.get('callee').isIdentifier() && path.node.callee.name === 'invokeExpression') {
        this.__invokeId = this.__invokeId || 0;
        path.node.__invokeId = this.__invokeId++;
      }
    }
  }
  return markInvoke;
}