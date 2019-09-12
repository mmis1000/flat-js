module.exports = function (t) {
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
  return rewriteIdentifier;
}