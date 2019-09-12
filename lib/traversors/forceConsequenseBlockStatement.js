module.exports= function (t) {
  var ensureKeyBlockStatement = function (...keys) {
    // console.log(keys)
    return function (path) {
      let node = path.node;
      // console.log(node.type)
      keys.forEach(function (name) {
        if (!node[name]) return;
        if (Array.isArray(node[name])) return;
        // console.log(node[name].type);
        if (t.isBlockStatement(node[name])) return;
        
        if (t.isLabeledStatement(node[name])) {
          var parentLabel = node[name]
          while (t.isBlockStatement(parentLabel.body)) {
            parentLabel = parentLabel.body;
          }
          if (t.isBlockStatement(parentLabel.body)) return
          parentLabel.body = t.blockStatement([parentLabel.body]);
        } else {
          if (t.isExpression(node[name])) {
            // special case for single expression arrow function
            if (!t.isArrowFunctionExpression(node)) {
              node[name] = t.expressionStatement(node[name]);
            } else {
              node[name] = t.returnStatement(node[name]);
            }
          }
          node[name] = t.blockStatement([node[name]]);
        }
      })
    }
  }
  
  var forceConsequenseBlockStatement = {
    IfStatement: ensureKeyBlockStatement('consequent', 'alternate'),
    BlockParent: ensureKeyBlockStatement('body')
  };
  
  return forceConsequenseBlockStatement;
}