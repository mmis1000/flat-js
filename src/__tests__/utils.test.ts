import { compileAndRun } from '../index'

test('compileAndRun: ', () => {
    expect(compileAndRun('42')).toBe(42)
})

test('compileAndRun: only ExpressionStatement affects result ', () => {
    expect(compileAndRun('var a = 42')).toBe(undefined)
})
test('compileAndRun: only ExpressionStatement affects result ', () => {
    expect(compileAndRun('42; for (let i = 0; i < 5; i++);')).toBe(42)
})