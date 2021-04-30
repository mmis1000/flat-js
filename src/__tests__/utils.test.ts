import { compileAndRun } from '../index'

test('compileAndRun: ', () => {
    expect(compileAndRun('42')).toBe(42)
})

test('compileAndRun: only ExpressionStatement affects result ', () => {
    expect(compileAndRun('var a = 42')).toBe(undefined)
})

test('compileAndRun: last ExpressionStatement affects result ', () => {
    expect(compileAndRun('42; for (let i = 0; i < 5; i++);')).toBe(42)
})

test('compileAndRun: finally does not affects result ', () => {
    expect(compileAndRun('try { throw 0 } catch (err) { 42 } finally { 43 }')).toBe(42)
})

test('compileAndRun: finally does not affects result ', () => {
    expect(compileAndRun('try { 42 } catch (err) {} finally { 43 }')).toBe(42)
})