import { gzipSync, gunzipSync } from 'zlib'
import { compile, collectUsedOpcodes } from '../compiler'
import { compileAndRun } from '../index'

test('collectUsedOpcodes: codeLength excludes literal pool tail when present', () => {
    const [programData, info] = compile('"x".repeat(3)')
    expect(info.codeLength).toBeLessThanOrEqual(programData.length)
    expect(collectUsedOpcodes(programData, info.codeLength).length).toBeGreaterThan(0)
})

test('gzip roundtrip matches raw VM program bytes', () => {
    const [programData] = compile('1+1')
    const raw = Buffer.from(new Uint32Array(programData).buffer)
    expect(gunzipSync(gzipSync(raw)).equals(raw)).toBe(true)
})

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