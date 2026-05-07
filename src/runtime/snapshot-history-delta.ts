export type CompactJsonValue =
    | null
    | boolean
    | number
    | string
    | CompactJsonValue[]
    | { [key: string]: CompactJsonValue }

export type CompactJsonDelta =
    | { kind: 'replace', value: CompactJsonValue }
    | { kind: 'object', entries: Record<string, CompactJsonDelta | { kind: 'delete' }> }
    | { kind: 'array', entries: Array<CompactJsonDelta | null> }
    | { kind: 'delete' }

const isPlainObject = (value: CompactJsonValue): value is { [key: string]: CompactJsonValue } =>
    value != null && typeof value === 'object' && !Array.isArray(value)

const cloneCompactJsonValue = (value: CompactJsonValue): CompactJsonValue => {
    if (Array.isArray(value)) {
        return value.map(cloneCompactJsonValue)
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneCompactJsonValue(entry)]))
    }
    return value
}

const compactJsonEquals = (left: CompactJsonValue, right: CompactJsonValue): boolean => {
    if (Object.is(left, right)) {
        return true
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((entry, index) => compactJsonEquals(entry, right[index]))
    }
    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left)
        const rightKeys = Object.keys(right)
        return leftKeys.length === rightKeys.length
            && leftKeys.every(key => Object.prototype.hasOwnProperty.call(right, key) && compactJsonEquals(left[key], right[key]))
    }
    return false
}

const buildCompactJsonDelta = (base: CompactJsonValue, next: CompactJsonValue): CompactJsonDelta | null => {
    if (compactJsonEquals(base, next)) {
        return null
    }
    if (Array.isArray(base) && Array.isArray(next) && base.length === next.length) {
        const entries = next.map((entry, index) => buildCompactJsonDelta(base[index], entry))
        return entries.some(entry => entry !== null)
            ? { kind: 'array', entries }
            : null
    }
    if (isPlainObject(base) && isPlainObject(next)) {
        const entries: Record<string, CompactJsonDelta | { kind: 'delete' }> = {}
        let changed = false
        for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
            if (!Object.prototype.hasOwnProperty.call(next, key)) {
                entries[key] = { kind: 'delete' }
                changed = true
                continue
            }
            if (!Object.prototype.hasOwnProperty.call(base, key)) {
                entries[key] = { kind: 'replace', value: cloneCompactJsonValue(next[key]) }
                changed = true
                continue
            }
            const childDelta = buildCompactJsonDelta(base[key], next[key])
            if (childDelta) {
                entries[key] = childDelta
                changed = true
            }
        }
        return changed ? { kind: 'object', entries } : null
    }
    return { kind: 'replace', value: cloneCompactJsonValue(next) }
}

export const createCompactJsonDelta = (base: CompactJsonValue, next: CompactJsonValue): CompactJsonDelta =>
    buildCompactJsonDelta(base, next) ?? { kind: 'replace', value: cloneCompactJsonValue(next) }

export const applyCompactJsonDelta = (base: CompactJsonValue, delta: CompactJsonDelta): CompactJsonValue => {
    switch (delta.kind) {
        case 'replace':
            return cloneCompactJsonValue(delta.value)
        case 'delete':
            return null
        case 'array': {
            if (!Array.isArray(base)) {
                throw new Error('Compact JSON array delta requires an array base value')
            }
            return base.map((entry, index) => {
                const childDelta = delta.entries[index]
                return childDelta == null ? cloneCompactJsonValue(entry) : applyCompactJsonDelta(entry, childDelta)
            })
        }
        case 'object': {
            if (!isPlainObject(base)) {
                throw new Error('Compact JSON object delta requires an object base value')
            }
            const result: Record<string, CompactJsonValue> = Object.fromEntries(
                Object.entries(base).map(([key, value]) => [key, cloneCompactJsonValue(value)])
            )
            for (const [key, entry] of Object.entries(delta.entries)) {
                if (entry.kind === 'delete') {
                    delete result[key]
                    continue
                }
                result[key] = Object.prototype.hasOwnProperty.call(result, key)
                    ? applyCompactJsonDelta(result[key], entry)
                    : applyCompactJsonDelta(null, entry)
            }
            return result
        }
    }
}
