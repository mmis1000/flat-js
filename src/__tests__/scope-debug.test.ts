import { compile, OpCode, SpecialVariable } from '../compiler'
import { Fields, getExecution, getScopeDebugEntries, getScopeDebugPtr, isRuntimeInternalKey, materializeScopeStaticBindings, run } from '../runtime'

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
        .map((opcode, ptr) =>
            opcode === OpCode.EnterFunction || opcode === OpCode.EnterScope || opcode === OpCode.EnterBodyScope
                ? ptr
                : -1
        )
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

test('static local slots are not mirrored as scope object aliases', () => {
    const [program, info] = compile(`
function runner(arg) {
    let local = arg + 1
    debugger
    return local
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

    const functionScope = capturedScopes[0]
    const functionPtr = getScopeDebugPtr(functionScope)
    const functionEntries = getScopeDebugEntries(functionScope, info.scopeDebugMap.get(functionPtr!) ?? [])

    expect(Object.prototype.hasOwnProperty.call(functionScope, 'local')).toBe(false)
    expect(functionEntries.find(([name]) => name === 'local')?.[1]).toBe(3)
})

test('web REPL can explicitly materialize paused static scope aliases', () => {
    const [program, info] = compile(`
function runner() {
    let local = 2
    {
        let block = local + 1
        debugger
    }
    return local + replVar
}
runner()
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

    const functionScope = capturedScopes[0]
    const blockScope = capturedScopes[1]
    expect(Object.prototype.hasOwnProperty.call(functionScope, 'local')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(blockScope, 'block')).toBe(false)

    for (const scope of capturedScopes) {
        materializeScopeStaticBindings(scope)
    }
    const localDescriptor = Reflect.getOwnPropertyDescriptor(functionScope, 'local')
    expect(typeof localDescriptor?.get).toBe('function')
    expect(typeof localDescriptor?.set).toBe('function')
    expect(functionScope.local).toBe(2)
    expect(blockScope.block).toBe(3)
    functionScope.local = 4
    expect(getScopeDebugEntries(functionScope, info.scopeDebugMap.get(getScopeDebugPtr(functionScope)!) ?? [])
        .find(([name]) => name === 'local')?.[1]).toBe(4)

    const [replProgram] = compile('local = 5; var replVar = 7', { evalMode: true })
    const currentFrame = execution[Fields.stack][execution[Fields.stack].length - 1]
    run(
        replProgram,
        0,
        globalThis,
        [...execution[Fields.scopes]],
        undefined,
        [],
        compile,
        undefined,
        undefined,
        currentFrame[Fields.variableEnvironment] ?? null
    )
    for (const scope of capturedScopes) {
        materializeScopeStaticBindings(scope)
    }

    expect(functionScope.local).toBe(5)
    expect(functionScope.replVar).toBe(7)
    expect(Object.prototype.hasOwnProperty.call(blockScope, 'replVar')).toBe(false)

    const functionPtr = getScopeDebugPtr(functionScope)
    const functionEntries = getScopeDebugEntries(functionScope, info.scopeDebugMap.get(functionPtr!) ?? [])
    expect(functionEntries.find(([name]) => name === 'local')?.[1]).toBe(5)
    expect(functionEntries.find(([name]) => name === 'replVar')?.[1]).toBe(7)
})
