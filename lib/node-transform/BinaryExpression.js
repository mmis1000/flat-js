module.exports = function BinaryExpression(node, ir, transform) {
    var allowed = ['+', '-', '>', '<', '>=', '<=']
    if (allowed.indexOf(node.operator) < 0) throw new Error(`not implement ${node.operator}`)

    if (node.operator === '+') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([new ir.add()])
    } if (node.operator === '-') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([new ir.subtract()])
    } if (node.operator === '>') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([new ir.compare()])
    } if (node.operator === '>=') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([new ir.compareWithEqual()])
    } if (node.operator === '<') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([
            new ir.dupeVal(1),
            new ir.compare(),
            new ir.putNumber(2),
            new ir.sequence()
        ])
    } if (node.operator === '<=') {
        return transform(node.left)
        .concat(transform(node.right))
        .concat([
            new ir.dupeVal(1),
            new ir.compareWithEqual(),
            new ir.putNumber(2),
            new ir.sequence()
        ])
    }
}