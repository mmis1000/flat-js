import { compile, OpCode, SpecialVariable } from '../compiler'
import { Fields, getExecution, getScopeDebugEntries, getScopeDebugPtr, isRuntimeInternalKey } from '../runtime'

test('compiler attaches scope debug names to enter ptr locations', () => {
    const [program, info] = compile(`
const runner = function named(arg) {
    let local = arg + 1
    {
        let blockValue = local + 1
        return blockValue
    }
}
runner(2)
`, { range: true })

    const scopeDebugMap = info.scopeDebugMap
    expect(scopeDebugMap).toBeDefined()

    const enterPtrs = program
        .slice(0, info.codeLength)
        .map((opcode, ptr) => opcode === OpCode.EnterFunction || opcode === OpCode.EnterScope ? ptr : -1)
        .filter(ptr => ptr >= 0)

    expect(enterPtrs.length).toBeGreaterThan(0)
    expect(enterPtrs.every(ptr => scopeDebugMap?.has(ptr))).toBe(true)

    const scopeNameSets = [...scopeDebugMap!.values()].map(names => new Set(names))
    expect(scopeNameSets.some(names =>
        names.has('arg')
        && names.has('local')
        && names.has('arguments')
        && names.has(SpecialVariable.This)
        && names.has(SpecialVariable.NewTarget)
        && names.has('named')
    )).toBe(true)
    expect(scopeNameSets.some(names => names.has('blockValue'))).toBe(true)
})

test('scope debug entries use compiler ptr metadata and hide runtime internals', () => {
    const [program, info] = compile(`
const runner = function named(arg) {
    let local = arg + 1
    {
        debugger
        let later = local + 1
    }
}
runner(2)
`, { range: true })

    let capturedScopes: any[] = []
    let execution: ReturnType<typeof getExecution>
    execution = getExecution(program, 0, globalThis, [], undefined, [], () => () => {
        capturedScopes = execution[Fields.scopes].slice()
    }, compile)

    while (capturedScopes.length === 0) {
        const result = execution[Fields.step](true)
        if (result[Fields.done]) {
            throw new Error('debugger statement was not reached')
        }
    }

    expect(capturedScopes).toHaveLength(2)

    const [functionScope, blockScope] = capturedScopes
    const functionPtr = getScopeDebugPtr(functionScope)
    const blockPtr = getScopeDebugPtr(blockScope)
    expect(functionPtr).toBeDefined()
    expect(blockPtr).toBeDefined()

    const functionEntries = getScopeDebugEntries(functionScope, info.scopeDebugMap.get(functionPtr!) ?? [])
    const functionNames = functionEntries.map(([name]) => name)

    expect(Reflect.ownKeys(functionScope).some(isRuntimeInternalKey)).toBe(true)
    expect(functionNames).toEqual(expect.arrayContaining([
        'arg',
        'local',
        'arguments',
        SpecialVariable.This,
        SpecialVariable.NewTarget,
        'named'
    ]))
    expect(functionNames.some(name => name.includes('scope'))).toBe(false)

    const laterEntry = getScopeDebugEntries(blockScope, info.scopeDebugMap.get(blockPtr!) ?? []).find(([name]) => name === 'later')
    expect(laterEntry).toBeDefined()
    expect(laterEntry![2]).toBe(true)
    expect(String(laterEntry![1])).toContain("Cannot access 'later' before initialization")
})
