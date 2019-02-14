module.exports = function ReturnStatement(node, ir, transform) {
    return [new ir.putBoolean(node.value)];
}