module.exports= function (t) {
  var resolveInvoke = {
    CallExpression(path) {
      if (path.get('callee').isIdentifier() && path.node.callee.name === 'invokeExpression') {
        let rootPath = path.getStatementParent();
        rootPath.insertBefore(
          t.expressionStatement(
            t.assignmentExpression("=", t.identifier('__jump' + path.node.__invokeId + '__'), 
              t.callExpression(t.Identifier("resultOf"), path.node.arguments)
            )
          )
        )
        path.replaceWith(t.stringLiteral('__resume' + path.node.__invokeId + '__'))
      }
    }
  }
}