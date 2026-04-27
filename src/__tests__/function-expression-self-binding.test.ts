import * as compiler from '../compiler'
import * as runtime from '../runtime'

test('named function expression self binding shadows outer minified variable names', () => {
    const code = `
(function(){
    var t = false
    var seen = 0
    var self = {
        add: function() {
            return (function t(args) {
                Array.prototype.forEach.call(args, function(arg) {
                    if (arg && arg.length && typeof arg !== 'string') {
                        t(arg)
                    } else {
                        seen++
                    }
                })
            }(arguments), this)
        }
    }
    self.add([1])
    return seen
})()
`

    const [program] = compiler.compile(code, { evalMode: true, shuffleSeed: 1 })
    const [protectedProgram] = compiler.compile(code, { evalMode: true, protectedMode: true, shuffleSeed: 1 })

    expect(runtime.run(program, 0, globalThis, [])).toBe(1)
    expect(runtime.run(protectedProgram, 0, globalThis, [])).toBe(1)
})
