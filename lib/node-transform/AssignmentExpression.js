module.exports = function AssignmentExpression(node, ir, transform) {
    if (node.operator !== '=') throw new Error(`not implement ${node.operator}`)
    return transform.l(node.left)
    .concat(transform(node.right))
    .concat([new ir.setVal])
}