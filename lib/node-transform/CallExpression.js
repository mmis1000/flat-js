module.exports = function CallExpression(node, ir, transform) {
    var result;
    var funcName;
    var length = node.arguments.length;
    
    if (node.callee.type === 'Identifier') {
        result = [
            new ir.getScope,
            new ir.dupeVal,
            new ir.putString(node.callee.name),
            new ir.getVal
        ]
    } else if (node.callee.type === 'MemberExpression') {
        result = transform(node.callee.object).concat([
            new ir.dupeVal
        ])
        if (node.callee.computed) {
            result = result.concat(transform(node.callee.property)).concat([
                new ir.getVal()
            ])
        } else {
            result = result.concat([
                new ir.putString(node.callee.property.name),
                new ir.getVal()
            ])
        }
    } else {
        result = [
            new ir.getScope,
        ].concat(
            transform(node.callee)
        )
    }
    
    for (var i = 0; i < length; i++) {
        result = result.concat(transform(node.arguments[i]))
    }
    
    result.push(new ir.putNumber(length))
    result.push(new ir.call())
    
    return result;
}