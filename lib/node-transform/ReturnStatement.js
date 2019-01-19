module.exports = function ReturnStatement(node, ir, transform) {
    if (node.argument) {
        return transform(node.argument).concat([new ir.leaveScope])
    } else {
        return [
            new ir.putUndefined,
            new ir.leaveScope
        ];
    }
}