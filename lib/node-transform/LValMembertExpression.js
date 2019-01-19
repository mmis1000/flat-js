module.exports = function MemberExpression(node, ir, transform) {
    if (node.computed) {
        return transform(node.object)
        .concat(transform(node.property))
    } else {
        return transform(node.object)
        .concat([
            new ir.putString(node.property.name)
        ]);
    }
}