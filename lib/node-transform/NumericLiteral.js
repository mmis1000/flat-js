module.exports = function VariableDeclaration(node, ir, transform) {
    return [new ir.putNumber(node.value)];
}