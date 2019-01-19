module.exports= function (t) {
  var splitAction = {
    BinaryExpression(path) {
      let node = path.node;
      console.log('binary', path.parentPath.inList, path.parentPath.parentPath.inList, path.parentPath.node.type)
      if (path.parentPath.inList || (path.parentPath.parentPath.inList && t.isAssignmentExpression(path.parentPath.node))) {
        return;
      }
      let functionPath = path.getFunctionParent();
      let identifier = path.scope.generateUidIdentifier("binary_uid");
      functionPath.scope.push({id: identifier})
      path.getStatementParent().insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            path.node
            // t.binaryExpression(node.operator, node.left, node.right)
            // t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
          )
        )
      )
      path.replaceWith(
        identifier
      );
    },
    AssignmentExpression(path) {
      let node = path.node
      console.log('assign', path.parentPath.inList, path.parentPath.parentPath.inList, path.parentPath.node.type)
      if (path.parentPath.inList || (path.parentPath.parentPath.inList && t.isAssignmentExpression(path.parentPath.node))) {
        return;
      }
      let functionPath = path.getFunctionParent();
      let identifier = path.scope.generateUidIdentifier("assign_uid");
      
      console.log('  ', identifier.name, node.right.type)
      
      functionPath.scope.push({id: identifier})
      path.getStatementParent().insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            path.node
            // t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
          )
        )
      )
      path.replaceWith(
        identifier
      );
    },
    CallExpression(path) {
      console.log('call  ', path.parentPath.inList, path.parentPath.parentPath.inList, path.parentPath.node.type)
      if (path.parentPath.inList || (path.parentPath.parentPath.inList && t.isAssignmentExpression(path.parentPath.node))) {
        return;
      }
      let functionPath = path.getFunctionParent();
      let identifier = path.scope.generateUidIdentifier("uid");
      functionPath.scope.push({id: identifier})
      path.getStatementParent().insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            path.node
            // t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
          )
        )
      )
      path.replaceWith(
        identifier
      );
    },
    MemberExpression(path) {
      console.log('member  ', path.parentPath.inList, path.parentPath.parentPath.inList, path.parentPath.node.type)
      if (path.parentPath.inList || (path.parentPath.parentPath.inList && t.isAssignmentExpression(path.parentPath.node)) || t.isCallExpression(path.parentPath.node)) {
        return;
      }
      let functionPath = path.getFunctionParent();
      let identifier = path.scope.generateUidIdentifier("uid");
      functionPath.scope.push({id: identifier})
      path.getStatementParent().insertBefore(
        t.expressionStatement(
          t.assignmentExpression("=", identifier, 
            path.node
            // t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
          )
        )
      )
      path.replaceWith(
        identifier
      );
    }
  }
  
  return splitAction;
}