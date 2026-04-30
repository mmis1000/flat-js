import { STATIC_SLOT_NAMELESS } from "../compiler/shared"
import { Fields, SCOPE_DEBUG_PTR, SCOPE_FLAGS, SCOPE_STATIC_SLOTS, SCOPE_STATIC_STORE, TDZ_VALUE, type Scope, type ScopeDebugEntry, type ScopeWithInternals } from "./shared"

const getScopeInternal = (scope: Scope) => scope as ScopeWithInternals

export const isRuntimeInternalKey = (key: string | symbol) =>
    key === SCOPE_FLAGS
    || key === SCOPE_STATIC_SLOTS
    || key === SCOPE_STATIC_STORE
    || key === SCOPE_DEBUG_PTR

export const getScopeDebugPtr = (scope: Scope) =>
    getScopeInternal(scope)[SCOPE_DEBUG_PTR]

const hasScopeBindingForDebug = (scope: Scope, name: string) => {
    const internal = getScopeInternal(scope)
    return internal[SCOPE_STATIC_SLOTS]?.[name] !== undefined
        || internal[SCOPE_FLAGS]?.[name] !== undefined
        || name in scope
}

const getScopeDebugNames = (scope: Scope, debugNames: readonly string[] = []) => {
    const names: string[] = []
    const seen = new Set<string>()
    const push = (name: string) => {
        if (!seen.has(name) && hasScopeBindingForDebug(scope, name)) {
            seen.add(name)
            names.push(name)
        }
    }

    for (const name of debugNames) {
        push(name)
    }
    for (const key of Reflect.ownKeys(scope)) {
        if (typeof key === 'string' && !isRuntimeInternalKey(key)) {
            push(key)
        }
    }
    return names
}

const readScopeBindingValueForDebug = (scope: Scope, name: string) => {
    const internal = getScopeInternal(scope)
    const slotIndex = internal[SCOPE_STATIC_SLOTS]?.[name]
    const value = slotIndex !== undefined
        ? internal[SCOPE_STATIC_STORE]?.[Fields.values][slotIndex]
        : scope[name]
    if (value === TDZ_VALUE) {
        throw new ReferenceError(`Cannot access '${name}' before initialization`)
    }
    return value
}

export const getScopeDebugEntries = (scope: Scope, debugNames: readonly string[] = []): ScopeDebugEntry[] =>
    getScopeDebugNames(scope, debugNames).map((name): ScopeDebugEntry => {
        try {
            return [name, readScopeBindingValueForDebug(scope, name), false]
        } catch (err) {
            return [name, String(err), true]
        }
    })

export const materializeScopeStaticBindings = (scope: Scope) => {
    const store = getScopeInternal(scope)[SCOPE_STATIC_STORE]
    if (store == null) {
        return
    }

    for (let index = 0; index < store[Fields.names].length; index++) {
        const name = store[Fields.names][index]!
        if (name !== STATIC_SLOT_NAMELESS) {
            Reflect.defineProperty(scope, name, {
                configurable: true,
                enumerable: true,
                get() {
                    const value = store[Fields.values][index]
                    if (value === TDZ_VALUE) {
                        throw new ReferenceError(`Cannot access '${name}' before initialization`)
                    }
                    return value
                },
                set(value) {
                    store[Fields.values][index] = value
                },
            })
        }
    }
}
