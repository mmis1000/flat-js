module.exports = function UpdateExpression(node, ir, transform) {
    var getVal = transform(node.argument);
    var op = node.operator === '++' ? new ir.add() : new ir.subtract()
    var lVal = transform.l(node.argument);
    
    if (node.prefix) {
        return lVal
        .concat(getVal)
        .concat([
            new ir.putNumber(1), 
            op,
            new ir.setVal()
        ])
    } else {
        return lVal
        .concat(getVal)
        .concat([
            new ir.dupeVal(2),
            new ir.dupeVal(2),
            new ir.dupeVal(2),
            new ir.putNumber(1), 
            op,
            new ir.setVal(),
            new ir.pop(),
            new ir.putNumber(3),
            new ir.sequence()
        ])
    }
}