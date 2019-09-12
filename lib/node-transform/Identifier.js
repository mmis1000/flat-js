module.exports = function Identifier(node, ir, transform) {
    return [
        new ir.getScope(),
        new ir.putString(node.name),
        new ir.getVal()
    ]
}