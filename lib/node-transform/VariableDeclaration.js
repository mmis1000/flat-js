function flat(arr_arr) {
    return [].concat.apply([], arr_arr);
}
module.exports = function VariableDeclaration(node, ir, transform) {
    if (node.kind !== 'var') throw new Error(`not implemented ${node.kind}`)
    return flat(node.declarations.map(function (variableDeclarator) {
        if (variableDeclarator.init) {
            return transform(variableDeclarator.init).concat([
                new ir.putString(variableDeclarator.id.name), 
                new ir.newVar()
            ])
        } else {
            return [
                new ir.putUndefined(),
                new ir.putString(variableDeclarator.id.name), 
                new ir.newVar()
            ]
        }
    }))
}