module.exports = function ReturnStatement(node, ir, transform) {
    return [new ir.putString(node.value)];
}