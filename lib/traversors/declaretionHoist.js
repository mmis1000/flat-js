module.exports= function (t) {
  var declaretionHoist = {
    FunctionDeclaration(path) {
      var node = path.node;
      var id = node.id;
      path.replaceWith(t.assignmentExpression('=', id, t.functionExpression(
        node.id,
        node.params,
        node.body,
        node.generator,
        node.async
      )))
      path.getFunctionParent().scope.push({id})
    },
    VariableDeclaration(path) {
      var node = path.node;
      var prevPath = path.getSibling(path.key - 1);
      var functionPath = path.getFunctionParent();
      // console.log(node.declarations.map(function(item){return(item.id.name)}).join(', '));
      // console.log(path.key);
      // console.log(functionPath.node.type)
      
      var atBase = (functionPath.isProgram() && path.parentPath.isProgram()) || 
        path.parentPath.parentPath.isFunctionDeclaration() ||
        path.parentPath.parentPath.isFunctionExpression() ||
        path.parentPath.parentPath.isArrowFunctionExpression();
      
      if (atBase && (prevPath.isVariableDeclaration() || path.key === 0)) {
        return;
      }
      
      if (node.kind === 'let') {
        console.log('does not hoist let declare');
        return;
      }
      node.declarations.filter(function (item) {
        return item.init !== null;
      }).forEach(function (item) {
        // path.scope.removeOwnBinding(item.id.name);
        functionPath.scope.push({id: item.id})
        path.insertAfter(
          t.expressionStatement(t.assignmentExpression('=', item.id, item.init))
        )
      })
      path.parent.body.splice(path.key, 1);
      path.resync();
      /*
      path.remove();
      functionPath.unshiftContainer(t.variableDeclaration(
        node.kind,
        node.declarations.map(function(item) {
            return t.variableDeclarator(item.id)
        })
      ))
      node.declarations.forEach(function (item) {
      })*/
      /*
      path.replaceWithMultiple(
        node.declarations.filter(function (item) {
          return item.init !== null;
        }).map(function (item) {
          return t.expressionStatement(t.assignmentExpression('=', item.id, item.init))
        })
      )
      node.declarations.forEach(function (item) {
        console.log(item.id)
        try {
          functionPath.scope.push({id: item.id})
        } catch (e) {
          console.error(e)
        }
      })*/
    }
  }
  return declaretionHoist;
}