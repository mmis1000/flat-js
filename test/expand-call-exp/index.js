let t;
var template =require("babel-template").template;

module.exports = function(babel) {
  t = babel.types;
  return {
    visitor: {
      Program(path) {
        // console.log(path);
        /*path.node.body.unshift(babel.transform('function binaryOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function assignmentOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function getReference() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function unaryOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function updateOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function getValue() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function invokeExpression() {}').ast.program.body[0]);
        */
        
        var state = {};
        
        state.whiteListed = {
          binaryOperate: true, 
          assignmentOperate: true, 
          getReference: true, 
          unaryOperate: true,
          updateOperate: true,
          getValue: true,
          invokeExpression: true
        }
        state.functions = [];
        state.functionIndex = 0;
        
        path.traverse(forceConsequenseBlockStatement, state);
        path.traverse(escapeControlInLoop, state);
        path.traverse(replaceCondition, state);
        path.traverse(splitAction, state);
        path.traverse(declaretionHoist, state);
        path.traverse(collectFunctions, state);
        path.traverse(rewriteIdentifier, state);
        path.traverse(markInvoke, state);
        path.traverse(resolveInvoke, state);
        
        console.log('there are ' + state.functions.length + ' functions in this program')
        
      },
    }
  }
}


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

var markInvoke = {
  CallExpression(path) {
    if (path.get('callee').isIdentifier() && path.node.callee.name === 'invokeExpression') {
      this.__invokeId = this.__invokeId || 0;
      path.node.__invokeId = this.__invokeId++;
    }
  }
}

var collectFunctions = {
  FunctionExpression(path) {
    this.functions.push(path.node);
    path.node._index = this.functionIndex++;
  }
}

var rewriteIdentifier = {
  Identifier(path) {
    if (['id', 'key'].indexOf(path.key) >= 0) return;
    if (this.whiteListed[path.node.name]) return;
    path.replaceWith(
      t.callExpression(
        t.identifier('getReference'),
        [t.stringLiteral(path.node.name)]
      )
    )
  },
  MemberExpression(path) {
    if (path.node.computed) {
      path.replaceWith(
        t.callExpression(
          t.identifier('getReference'),
          [
            path.node.property,
            path.node.object
          ]
        )
      )
    } else {
      path.replaceWith(
        t.callExpression(
          t.identifier('getReference'),
          [
            t.stringLiteral(path.node.property.name),
            path.node.object
          ]
        )
      )
    }
  },
  AssignmentExpression(path) {
    path.replaceWith(
      t.callExpression(
        t.identifier('assignmentOperate'),
        [
          path.node.left,
          path.node.right,
          t.stringLiteral(path.node.operator)
        ]
      )
    )
  },
  UnaryExpression(path) {
    path.replaceWith(
      t.callExpression(
        t.identifier('unaryOperate'),
        [
          path.node.argument,
          t.stringLiteral(path.node.operator),
          t.booleanLiteral(path.node.prefix)
        ]
      )
    )
  },
  UpdateExpression(path) {
    path.replaceWith(
      t.callExpression(
        t.identifier('updateOperate'),
        [
          path.node.argument,
          t.stringLiteral(path.node.operator),
          t.booleanLiteral(path.node.prefix)
        ]
      )
    )
  },
  BinaryExpression(path) {
    path.replaceWith(
      t.callExpression(
        t.identifier('binaryOperate'),
        [
          path.node.left,
          path.node.right,
          t.stringLiteral(path.node.operator)
        ]
      )
    )
  },
  CallExpression(path) {
    if (path.get('callee').isIdentifier() && (path.node.callee.name === 'getValue' || path.node.callee.name === 'assignmentOperate')) return;
    if (this.whiteListed[path.node.callee.name]) {
      if (!path.parentPath.isCallExpression()  ||
        !path.parentPath.get('callee').isIdentifier() ||
        !this.whiteListed[path.parentPath.get('callee').node.name]) {
        path.replaceWith(
          t.callExpression(
            t.identifier('getValue'),
            [
              path.node
            ]
          )
        )
      }
    } else {
      path.replaceWith(
        t.callExpression(
          t.identifier('invokeExpression'),
          [
            path.node.callee,
            t.arrayExpression(path.node.arguments)
          ]
        )
      )
    }
  },
}

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
    console.log(node.declarations.map(function(item){return(item.id.name)}).join(', '));
    console.log(path.key);
    console.log(functionPath.node.type)
    
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
  }
}

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

var ensureKeyBlockStatement = function (...keys) {
  console.log(keys)
  return function (path) {
    let node = path.node;
    console.log(node.type)
    keys.forEach(function (name) {
      if (!node[name]) return;
      if (Array.isArray(node[name])) return;
      console.log(node[name].type);
      if (t.isBlockStatement(node[name])) return;
      if (t.isExpression(node[name])) {
        // special case for single expression arrow function
        if (!t.isArrowFunctionExpression(node)) {
          node[name] = t.expressionStatement(node[name]);
        } else {
          node[name] = t.returnStatement(node[name]);
        }
      }
      node[name] = t.blockStatement([node[name]]);
    })
  }
}

var forceConsequenseBlockStatement = {
  IfStatement: ensureKeyBlockStatement('consequent', 'alternate'),
  BlockParent: ensureKeyBlockStatement('body')
}

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