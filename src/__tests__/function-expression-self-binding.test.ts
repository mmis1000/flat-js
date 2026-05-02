import * as compiler from '../compiler'
import * as runtime from '../runtime'
import { compileAndRun } from '../index'

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

    const [program] = compiler.compile(code, { evalMode: true })

    expect(runtime.run(program, 0, globalThis, [])).toBe(1)
})

test('named function expression self binding is immutable', () => {
    expect(compileAndRun(`
        var ref = function BindingIdentifier() {
            BindingIdentifier = 1
            ;(() => {
                BindingIdentifier = 2
            })()
            eval('BindingIdentifier = 3')
            return BindingIdentifier
        }

        ref() === ref
    `)).toBe(true)

    expect(() => compileAndRun(`
        'use strict'
        var ref = function BindingIdentifier() {
            BindingIdentifier = 1
        }

        ref()
    `)).toThrow(TypeError)
})
