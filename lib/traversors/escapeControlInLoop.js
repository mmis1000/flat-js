module.exports = function (t) {
  var escapeControlInLoop = {
    ForStatement(path) {
      let node = path.node;
      let body = node.body;
      let newLoop;
      let functionPath = path.getFunctionParent();
      let identifier = functionPath.scope.generateUidIdentifier("for_uid");
      console.log('uid: ' + identifier.name)
      functionPath.scope.push({id: identifier})
      path.insertBefore(
        t.isExpression(node.init) ? t.expressionStatement(node.init) : node.init
      )
      path.insertBefore(
        t.expressionStatement(t.assignmentExpression('=', identifier, node.test))
      )
      body.body.push(t.expressionStatement(node.update));
      body.body.push(t.expressionStatement(t.assignmentExpression('=', identifier, node.test)))
      path.replaceWith(
        t.whileStatement(identifier, body)
      )
    }
  }
  
  return escapeControlInLoop;
}