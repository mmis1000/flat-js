module.exports = function FunctionExpression(node, ir, transform) {
    return [new ir.createFunction(node._index)];
}