module.exports = function CallExpression(node, ir, transform) {
    var result;
    var funcName;
    var length = node.arguments.length;
    var isIntermidiateValue = false;
    
    if (node.callee.type === 'Identifier') {
        result = [
            new ir.getScope,
            new ir.putString(node.callee.name),
        ]
    } else if (node.callee.type === 'MemberExpression') {
        result = transform(node.callee.object)
        
        if (node.callee.computed) {
            result = result.concat(transform(node.callee.property))
        } else {
            result = result.concat([
                new ir.putString(node.callee.property.name)
            ])
        }
    } else {
        result = transform(node.callee)
        isIntermidiateValue = true
    }
    
    for (var i = 0; i < length; i++) {
        result = result.concat(transform(node.arguments[i]))
    }
    
    result.push(new ir.putNumber(length))
    
    if (!isIntermidiateValue) {
        result.push(new ir.call())
    } else {
        result.push(new ir.callIntr())
    }
    
    return result;
}