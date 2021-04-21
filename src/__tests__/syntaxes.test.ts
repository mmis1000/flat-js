import * as compiler from '../compiler'

const syntaxes = [
    ['number', '1'],
    ['number', '-1'],
    ['boolean', 'true'],
    ['boolean', 'false'],
    ['string', '"whatever"'],
    ['undefined', 'undefined'],
    ['Identifier ', 'variable'],
    ['PropertyAccessExpression', 'a.b'],
    ['ElementAccessExpression', 'a[b]'],
    ['BinaryExpression EqualsToken', 'variable = 1'],
    ['Left Identifier', 'variable = 1'],
    ['Left PropertyAccessExpression', 'a.b = 1'],
    ['Left ElementAccessExpression', 'a[b] = 1'],
    ['Left ElementAccessExpression', 'a[b] = 1'],
    ['VariableDeclarationList var without init', 'var a'],
    ['VariableDeclarationList var with init', 'var a = 0'],
    ['VariableDeclarationList let without init', 'let a'],
    ['VariableDeclarationList let with init', 'let a = 0'],
    ['VariableDeclarationList const', 'const a = 0'],
    ['ArrowFunction', '(() => 0)'],
    ['FunctionStatement', 'function a () {}'],
    ['FunctionExpression', '(function a () {})'],
    ['ObjectLiteral', '({})'],
    ['ObjectLiteral Property', '({ a: 0 })'],
    ['ObjectLiteral Property Shorthand', '({ a })'],
    ['ObjectLiteral Method', '({ a () {} })'],
    ['ObjectLiteral ComputedKey', '({ [a]: {} })'],
    ['ObjectLiteral String Key', '({ "a": {} })'],
    ['ObjectLiteral Number Key', '({ 0: {} })'],
    ['BinaryExpression Comma', '(0, 1)'],
    [
        'BinaryExpression - + ^ | || & && > 1 >> 1 >>> < << >= <= == === != !== * / in ',
        '1 - 1 + 1 ^ 1 | 1 || 1 & 1 && 1 > 1 >> 1 >>> 1 < 1 << 1 >= 1 <= 1 == 1 === 1 != 1 !== 1 * 1 / 1 in 1'
    ],
    ['PostfixUnaryExpression a++', 'a++'],
    ['PostfixUnaryExpression a--', 'a--'],
    ['DebuggerStatement', 'debugger'],
    ['Nested Scope', `
    let a = 0;
    {
        let a = 0;
    }
    `]
]

for (let [name, code] of syntaxes) {
    test(name, () => {
        expect(() => {
            compiler.compile(code)
        }).not.toThrow()
    })
}