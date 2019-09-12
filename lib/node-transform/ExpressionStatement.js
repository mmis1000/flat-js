module.exports = function ExpressionStatement(node, ir, transform) {
  return transform(node.expression).concat([new ir.pop()])
}