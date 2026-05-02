import * as compiler from '../compiler'

const syntaxes = [
    ['number', '1'],
    ['number', '-1'],
    ['boolean', 'true'],
    ['boolean', 'false'],
    ['string', '"whatever"'],
    ['TemplateLiteral no substitution', '`hello`'],
    ['TemplateLiteral with substitution', '`a${1}b`'],
    ['undefined', 'undefined'],
    ['Identifier ', 'variable'],
    ['PropertyAccessExpression', 'a.b'],
    ['ElementAccessExpression', 'a[b]'],
    ['BinaryExpression EqualsToken', 'variable = 1'],
    ['Left Identifier', 'variable = 1'],
    ['Left PropertyAccessExpression', 'a.b = 1'],
    ['Left ElementAccessExpression', 'a[b] = 1'],
    ['Left ElementAccessExpression', 'a[b] = 1'],
    ['Destructuring assignment array pattern', '([a, b = 1, ...rest] = items)'],
    ['Destructuring assignment object pattern', '({ a: b = 1, ...rest } = value)'],
    ['VariableDeclarationList var without init', 'var a'],
    ['VariableDeclarationList var with init', 'var a = 0'],
    ['VariableDeclarationList let without init', 'let a'],
    ['VariableDeclarationList let with init', 'let a = 0'],
    ['VariableDeclarationList let array pattern', 'let [a, b = 1, ...rest] = items'],
    ['VariableDeclarationList const', 'const a = 0'],
    ['VariableDeclarationList const object pattern', 'const { a: b = 1 } = value'],
    ['ArrowFunction', '(() => 0)'],
    ['ArrowFunction destructuring parameter', '(([a, b]) => a + b)'],
    ['ArrowFunction rest', '((...args) => args.length)'],
    ['FunctionStatement', 'function a () {}'],
    ['FunctionExpression', '(function a () {})'],
    ['ObjectLiteral', '({})'],
    ['ObjectLiteral Property', '({ a: 0 })'],
    ['ObjectLiteral Property Shorthand', '({ a })'],
    ['ObjectLiteral Method', '({ a () {} })'],
    ['ObjectLiteral ComputedKey', '({ [a]: {} })'],
    ['ObjectLiteral String Key', '({ "a": {} })'],
    ['ObjectLiteral Number Key', '({ 0: {} })'],
    ['CallExpression spread', 'fn(...args)'],
    ['TaggedTemplateExpression', 'tag`hello`'],
    ['BinaryExpression Comma', '(0, 1)'],
    [
        'BinaryExpression - + ^ | || & && > 1 >> 1 >>> < << >= <= == === != !== * / in ',
        '1 - 1 + 1 ^ 1 | 1 || 1 & 1 && 1 > 1 >> 1 >>> 1 < 1 << 1 >= 1 <= 1 == 1 === 1 != 1 !== 1 * 1 / 1 in 1'
    ],
    ['PostfixUnaryExpression a++', 'a++'],
    ['PostfixUnaryExpression a--', 'a--'],
    ['DebuggerStatement', 'debugger'],
    ['LabeledStatement block', 'label: { break label }'],
    ['LabeledStatement loop continue', 'label: for (let i = 0; i < 1; i++) { continue label }'],
    ['LabeledStatement let newline block', 'if (false) { label: let // ASI\n{} }'],
    ['LabeledStatement let newline identifier', 'if (false) { label: let // ASI\nvalue = 1 }'],
    ['IfStatement let newline block', 'if (false) let // ASI\n{}'],
    ['IfStatement sloppy direct function body', 'if (true) function f() {}'],
    ['WithStatement', 'with ({ value: 1 }) { value }'],
    ['Catch destructuring', 'try { throw value } catch ({ a, b }) { a + b }'],
    ['Catch block sloppy if function sharing catch parameter', 'try {} catch (e) { if (false) function e() {} }'],
    ['ForOf assignment pattern head', 'for ([a, b] of pairs) { a + b }'],
    ['Nested Scope', `
    let a = 0;
    {
        let a = 0;
    }
    `],
    // Hoisted function in switch default emits no ops; compiler must still emit a jump target (see NodeOffset).
    ['SwitchStatement default only hoisted function', `
    switch (1) {
      default:
        function f() {}
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

test('WhileStatement declaration body is a syntax error', () => {
    expect(() => {
        compiler.compile('while (false) function f() {}')
    }).toThrow(SyntaxError)
})

test('DoStatement declaration body is a syntax error', () => {
    expect(() => {
        compiler.compile('do function f() {} while (false)')
    }).toThrow(SyntaxError)
})

test('WhileStatement labelled function body is a syntax error', () => {
    expect(() => {
        compiler.compile('while (false) label: function f() {}')
    }).toThrow(SyntaxError)
})

test.each([
    ['class body', 'if (true) class C {}'],
    ['async function body', 'if (true) async function f() {}'],
    ['generator body', 'if (true) function* g() {}'],
    ['strict direct function body', '"use strict"; if (true) function f() {}'],
    ['labelled function body', 'if (false) label: function f() {}'],
    ['let array newline body', 'if (false) let\n[value] = []'],
])('IfStatement %s is a syntax error', (_name, code) => {
    expect(() => {
        compiler.compile(code)
    }).toThrow(SyntaxError)
})

test('Catch block function redeclaring catch parameter is a syntax error', () => {
    expect(() => {
        compiler.compile('try {} catch (e) { function e() {} }')
    }).toThrow(SyntaxError)
})

test('Catch block labelled function redeclaring catch parameter is a syntax error', () => {
    expect(() => {
        compiler.compile('try {} catch (e) { label: function e() {} }')
    }).toThrow(SyntaxError)
})

test.each([
    ['identifier', '(x, x) => 1'],
    ['array binding pattern', '(x, [x]) => 1'],
    ['object binding pattern', '(x, { x }) => 1'],
    ['rest parameter', '(x, ...x) => 1'],
])('ArrowFunction duplicate %s parameter is a syntax error', (_name, code) => {
    expect(() => {
        compiler.compile(code)
    }).toThrow(SyntaxError)
})
