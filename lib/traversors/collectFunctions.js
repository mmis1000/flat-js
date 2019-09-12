module.exports = function (t) {
  var collectFunctions = {
    FunctionExpression(path) {
      this.functions.push(path.node);
      path.node._index = this.functionIndex++;
    }
  }
  return collectFunctions;
}