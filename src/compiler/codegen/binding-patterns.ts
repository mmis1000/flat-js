import * as ts from 'typescript'

import { OpCode, VariableType } from '../shared'
import { markInternals, op } from './helpers'
import type { CodegenContext } from './context'
import type { Op, Segment } from './types'

type BindingInitOptions = {
    freezeConst?: boolean
    initializer?: ts.Expression
}

type TempState = {
    names: TempBinding[]
    allocate(prefix: string): TempBinding
}

type TempBinding = {
    name: string
    index: number
}

const staticDepthShiftOpcodes = new Set<OpCode>([
    OpCode.GetStatic,
    OpCode.GetStaticKeepCtx,
    OpCode.GetStaticUnchecked,
    OpCode.GetStaticUncheckedKeepCtx,
    OpCode.SetStatic,
    OpCode.SetStaticUnchecked,
    OpCode.SetInitializedStatic,
    OpCode.DeTDZStatic,
    OpCode.FreezeVariableStatic,
    OpCode.TypeofStaticReference,
    OpCode.TypeofStaticReferenceUnchecked,
    OpCode.BPlusEqualStatic,
    OpCode.BPlusEqualStaticUnchecked,
    OpCode.BMinusEqualStatic,
    OpCode.BMinusEqualStaticUnchecked,
    OpCode.BSlashEqualStatic,
    OpCode.BSlashEqualStaticUnchecked,
    OpCode.BAsteriskEqualStatic,
    OpCode.BAsteriskEqualStaticUnchecked,
    OpCode.BGreaterThanGreaterThanGreaterThanEqualStatic,
    OpCode.BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked,
    OpCode.PostFixPlusPLusStatic,
    OpCode.PostFixPlusPLusStaticUnchecked,
    OpCode.PostFixMinusMinusStatic,
    OpCode.PostFixMinusMinusStaticUnchecked,
    OpCode.PrefixPlusPlusStatic,
    OpCode.PrefixPlusPlusStaticUnchecked,
    OpCode.PrefixMinusMinusStatic,
    OpCode.PrefixMinusMinusStaticUnchecked,
])

const cloneSegment = (ops: Segment): Segment => ops.map((item) => ({
    ...item,
    preData: [...item.preData],
})) as Op<OpCode>[]

const shiftStaticDepths = (ops: Segment, delta: number): Segment => {
    const shifted = cloneSegment(ops)

    for (let index = 0; index < shifted.length; index++) {
        const current = shifted[index]!
        if (!staticDepthShiftOpcodes.has(current.op)) {
            continue
        }

        const depthLiteral = shifted[index - 2]
        const indexLiteral = shifted[index - 1]
        if (
            depthLiteral?.op === OpCode.Literal
            && indexLiteral?.op === OpCode.Literal
            && typeof depthLiteral.preData[0] === 'number'
            && typeof indexLiteral.preData[0] === 'number'
        ) {
            depthLiteral.preData[0] = (depthLiteral.preData[0] as number) + delta
        }
    }

    return shifted
}

const getTempValue = ({ index }: TempBinding): Segment => [
    op(OpCode.Literal, 2, [0]),
    op(OpCode.Literal, 2, [index]),
    op(OpCode.GetStaticUnchecked),
]

const setTempValue = ({ index }: TempBinding, valueOps: Segment): Segment => [
    ...valueOps,
    op(OpCode.Literal, 2, [0]),
    op(OpCode.Literal, 2, [index]),
    op(OpCode.SetStaticUnchecked),
    op(OpCode.Pop),
]

const generateSyntheticScopeEnter = (bindings: TempBinding[]): Segment => {
    if (bindings.length === 0) {
        return []
    }

    return markInternals([
        ...[...bindings].reverse().flatMap(({ name }) => [
            op(OpCode.Literal, 2, [name]),
            op(OpCode.Literal, 2, [VariableType.Var]),
        ]),
        op(OpCode.Literal, 2, [bindings.length]),
        op(OpCode.EnterScope),
    ])
}

const generateSyntheticScopeLeave = (): Segment => markInternals([
    op(OpCode.LeaveScope),
])

const generateThrowTypeError = (message: string): Segment => [
    op(OpCode.GetRecord),
    op(OpCode.Literal, 2, ['TypeError']),
    op(OpCode.Get),
    op(OpCode.Literal, 2, [message]),
    op(OpCode.Literal, 2, [1]),
    op(OpCode.New),
    op(OpCode.Throw),
]

const generateRequireObjectCoercible = (sourceTemp: TempBinding): Segment => {
    const throwNull = op(OpCode.Nop, 0)
    const after = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [throwNull]),
        ...getTempValue(sourceTemp),
        op(OpCode.NullLiteral),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIf),

        op(OpCode.NodeOffset, 2, [after]),
        ...getTempValue(sourceTemp),
        op(OpCode.UndefinedLiteral),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIfNot),

        throwNull,
        ...generateThrowTypeError('Cannot convert undefined or null to object'),
        after,
    ]
}

const generateApplyDefault = (
    targetTemp: TempBinding,
    initializer: ts.Expression,
    flag: number,
    ctx: CodegenContext
): Segment => {
    const skip = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [skip]),
        ...getTempValue(targetTemp),
        op(OpCode.UndefinedLiteral),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIfNot),
        ...setTempValue(targetTemp, shiftStaticDepths(ctx.generate(initializer, flag), 1)),
        skip,
    ]
}

const generateBindingLeafInitialization = (
    target: ts.Identifier,
    sourceTemp: TempBinding,
    _ctx: CodegenContext,
    options: BindingInitOptions
): Segment => {
    return [
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [target.text]),
        ...getTempValue(sourceTemp),
        op(OpCode.SetInitialized),
        op(OpCode.Pop),
        ...(options.freezeConst
            ? markInternals([
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [target.text]),
                op(OpCode.FreezeVariable),
                op(OpCode.Pop),
                op(OpCode.Pop),
            ])
            : []),
    ]
}

const generateIteratorFromTemp = (sourceTemp: TempBinding): Segment => [
    ...getTempValue(sourceTemp),
    op(OpCode.GetRecord),
    op(OpCode.Literal, 2, ['Symbol']),
    op(OpCode.Get),
    op(OpCode.Literal, 2, ['iterator']),
    op(OpCode.Get),
    op(OpCode.Literal, 2, [0]),
    op(OpCode.Call),
]

const generateArrayElementValue = (entryTemp: TempBinding, valueTemp: TempBinding): Segment => {
    const whenDone = op(OpCode.Nop, 0)
    const after = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [whenDone]),
        ...getTempValue(entryTemp),
        op(OpCode.EntryIsDone),
        op(OpCode.JumpIf),
        ...setTempValue(valueTemp, [
            ...getTempValue(entryTemp),
            op(OpCode.EntryGetValue),
        ]),
        op(OpCode.NodeOffset, 2, [after]),
        op(OpCode.Jump),
        whenDone,
        ...setTempValue(valueTemp, [op(OpCode.UndefinedLiteral)]),
        after,
    ]
}

const generatePropertyNameOps = (name: ts.PropertyName, flag: number, ctx: CodegenContext): Segment => {
    if (ts.isComputedPropertyName(name)) {
        return shiftStaticDepths(ctx.generate(name.expression, flag), 1)
    }

    if (ts.isIdentifier(name)) {
        return [op(OpCode.Literal, 2, [name.text])]
    }

    if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
        return ctx.generate(name, flag)
    }

    throw new Error('not support pattern yet')
}

function generateBindingPatternIntoTemp(
    pattern: ts.BindingName,
    sourceTemp: TempBinding,
    flag: number,
    ctx: CodegenContext,
    options: BindingInitOptions,
    temps: TempState
): Segment {
    if (ts.isIdentifier(pattern)) {
        return generateBindingLeafInitialization(pattern, sourceTemp, ctx, options)
    }

    if (ts.isArrayBindingPattern(pattern)) {
        const iteratorTemp = temps.allocate('binding.iter')
        const entryTemp = temps.allocate('binding.entry')
        const ops: Segment = [
            ...setTempValue(iteratorTemp, generateIteratorFromTemp(sourceTemp)),
        ]

        for (const element of pattern.elements) {
            if (ts.isOmittedExpression(element)) {
                ops.push(...setTempValue(entryTemp, [
                    ...getTempValue(iteratorTemp),
                    op(OpCode.NextEntry),
                ]))
                continue
            }

            const valueTemp = temps.allocate('binding.value')

            if (element.dotDotDotToken) {
                ops.push(...setTempValue(valueTemp, [
                    op(OpCode.ArrayLiteral),
                    ...getTempValue(iteratorTemp),
                    op(OpCode.ArraySpread),
                ]))
                ops.push(...generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps))
                continue
            }

            ops.push(...setTempValue(entryTemp, [
                ...getTempValue(iteratorTemp),
                op(OpCode.NextEntry),
            ]))
            ops.push(...generateArrayElementValue(entryTemp, valueTemp))

            if (element.initializer) {
                ops.push(...generateApplyDefault(valueTemp, element.initializer, flag, ctx))
            }

            ops.push(...generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps))
        }

        return ops
    }

    if (ts.isObjectBindingPattern(pattern)) {
        const ops: Segment = [
            ...generateRequireObjectCoercible(sourceTemp),
        ]

        for (const element of pattern.elements) {
            if (element.dotDotDotToken) {
                throw new Error('not support pattern yet')
            }

            const valueTemp = temps.allocate('binding.value')
            const propertyName = element.propertyName
                ?? (ts.isIdentifier(element.name) ? element.name : undefined)

            if (!propertyName) {
                throw new Error('not support pattern yet')
            }

            ops.push(...setTempValue(valueTemp, [
                ...getTempValue(sourceTemp),
                ...generatePropertyNameOps(propertyName, flag, ctx),
                op(OpCode.Get),
            ]))

            if (element.initializer) {
                ops.push(...generateApplyDefault(valueTemp, element.initializer, flag, ctx))
            }

            ops.push(...generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps))
        }

        return ops
    }

    throw new Error('not support pattern yet')
}

export function generateBindingInitialization(
    pattern: ts.BindingName,
    sourceOps: Segment,
    flag: number,
    ctx: CodegenContext,
    options: BindingInitOptions = {}
): Segment {
    const tempNames: TempBinding[] = []
    const temps: TempState = {
        names: tempNames,
        allocate(prefix: string) {
            const binding = {
                name: ctx.allocateInternalName(prefix),
                index: tempNames.length,
            }
            tempNames.push(binding)
            return binding
        },
    }

    const sourceTemp = temps.allocate('binding.source')
    const body: Segment = [
        ...(options.initializer ? generateApplyDefault(sourceTemp, options.initializer, flag, ctx) : []),
        ...generateBindingPatternIntoTemp(pattern, sourceTemp, flag, ctx, options, temps),
    ]

    return [
        ...generateSyntheticScopeEnter(tempNames),
        ...setTempValue(sourceTemp, shiftStaticDepths(sourceOps, 1)),
        ...body,
        ...generateSyntheticScopeLeave(),
    ]
}
