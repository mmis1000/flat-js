module.exports= function (t) {
  var replaceCondition = {
    ConditionalExpression(path) {
      let node = path.node;
      let functionPath = path.getFunctionParent();
      let rootPath = path.getStatementParent();
      let identifier = rootPath.scope.generateUidIdentifier("uid");
      functionPath.scope.push({id: identifier})
      rootPath.insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            node.test
            // t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
          )
        )
      )
      rootPath.insertBefore(
        t.ifStatement(
          identifier,
          t.blockStatement([t.expressionStatement(t.assignmentExpression("=", identifier, node.consequent))]),
          t.blockStatement([t.expressionStatement(t.assignmentExpression("=", identifier, node.alternate))])
        )
      )
      path.replaceWith(
        identifier
      );
    },
    LogicalExpression (path) {
      let node = path.node;
      let functionPath = path.getFunctionParent();
      let rootPath = path.getStatementParent();
      let identifier = rootPath.scope.generateUidIdentifier("uid");
      functionPath.scope.push({id: identifier})
      rootPath.insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            node.left
          )
        )
      )
      if (node.operator == "||") {
        rootPath.insertBefore(
          t.ifStatement(
            t.unaryExpression("!", identifier),
            t.blockStatement([t.expressionStatement(t.assignmentExpression("=", identifier, node.right))])
          )
        )
      } else if (node.operator == "&&") {
        rootPath.insertBefore(
          t.ifStatement(
            identifier,
            t.blockStatement([t.expressionStatement(t.assignmentExpression("=", identifier, node.right))])
          )
        )
      }
      path.replaceWith(
        identifier
      );
    },
    IfStatement(path) {
      let node = path.node;
      if (t.isIdentifier(node.test) || t.isImmutable(node.test)) return;
      let functionPath = path.getFunctionParent();
      let rootPath = path.getStatementParent();
      let identifier = rootPath.scope.generateUidIdentifier("uid");
      functionPath.scope.push({id: identifier})
      rootPath.insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            node.test
          )
        )
      )
      node.test = identifier;
    }
  }
  return replaceCondition;
}