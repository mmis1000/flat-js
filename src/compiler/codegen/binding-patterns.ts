import * as ts from 'typescript'

import { OpCode, STATIC_SLOT_NAMELESS, VariableType } from '../shared'
import { generateClassValue } from './handlers/classes'
import { generateFunctionDefinition } from './handlers/functions'
import { markInternals, op } from './helpers'
import type { CodegenContext } from './context'
import type { Op, Segment, StaticAccess } from './types'

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

const shiftStaticAccess = (access: StaticAccess, delta: number): StaticAccess => ({
    ...access,
    depth: access.depth + delta,
})

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
        ...[...bindings].reverse().flatMap(() => [
            op(OpCode.Literal, 2, [STATIC_SLOT_NAMELESS]),
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

const generateRequireObjectTemp = (resultTemp: TempBinding): Segment => {
    const fail = op(OpCode.Nop, 0)
    const done = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [fail]),
        ...getTempValue(resultTemp),
        op(OpCode.NullLiteral),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIf),

        op(OpCode.NodeOffset, 2, [done]),
        ...getTempValue(resultTemp),
        op(OpCode.Typeof),
        op(OpCode.Literal, 2, ['object']),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIf),

        op(OpCode.NodeOffset, 2, [done]),
        ...getTempValue(resultTemp),
        op(OpCode.Typeof),
        op(OpCode.Literal, 2, ['function']),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIf),

        fail,
        ...generateThrowTypeError('iterator result must be an object'),
        done,
    ]
}

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
    ctx: CodegenContext,
    nameHint?: string
): Segment => {
    const skip = op(OpCode.Nop, 0)
    const rawInitializer = ctx.extractQuote(initializer)
    const initializerOps = shiftStaticDepths(
        nameHint != null && nameHint !== ''
            ? ts.isArrowFunction(rawInitializer)
                ? generateFunctionDefinition(rawInitializer, nameHint)
                : ts.isFunctionExpression(rawInitializer) && rawInitializer.name == null
                    ? generateFunctionDefinition(rawInitializer, nameHint)
                    : ts.isClassExpression(rawInitializer) && rawInitializer.name == null
                        ? generateClassValue(rawInitializer, flag, ctx, nameHint)
                        : ctx.generate(initializer, flag)
            : ctx.generate(initializer, flag),
        1
    )

    return [
        op(OpCode.NodeOffset, 2, [skip]),
        ...getTempValue(targetTemp),
        op(OpCode.UndefinedLiteral),
        op(OpCode.BEqualsEqualsEquals),
        op(OpCode.JumpIfNot),
        ...setTempValue(targetTemp, initializerOps),
        skip,
    ]
}

const generateBindingLeafInitialization = (
    target: ts.Identifier,
    sourceTemp: TempBinding,
    ctx: CodegenContext,
    options: BindingInitOptions,
    resolvedTargetTemp?: TempBinding
): Segment => {
    const staticAccess = ctx.tryResolveStaticAccess(target, target.text)
    if (staticAccess) {
        const shiftedAccess = shiftStaticAccess(staticAccess, 1)
        return [
            ...getTempValue(sourceTemp),
            ...ctx.generateStaticAccessOps(shiftedAccess),
            op(OpCode.SetInitializedStatic),
            op(OpCode.Pop),
            ...(options.freezeConst
                ? markInternals([
                    ...ctx.generateStaticAccessOps(shiftedAccess),
                    op(OpCode.FreezeVariableStatic),
                ])
                : []),
        ]
    }

    return [
        ...(resolvedTargetTemp ? getTempValue(resolvedTargetTemp) : [op(OpCode.GetRecord)]),
        op(OpCode.Literal, 2, [target.text]),
        ...getTempValue(sourceTemp),
        op(OpCode.SetInitialized),
        op(OpCode.Pop),
        ...(options.freezeConst
            ? markInternals([
                ...(resolvedTargetTemp ? getTempValue(resolvedTargetTemp) : [op(OpCode.GetRecord)]),
                op(OpCode.Literal, 2, [target.text]),
                op(OpCode.FreezeVariable),
                op(OpCode.Pop),
                op(OpCode.Pop),
            ])
            : []),
    ]
}

const captureBindingIdentifierTarget = (target: ts.Identifier, temp: TempBinding, ctx: CodegenContext): Segment => {
    if (ctx.tryResolveStaticAccess(target, target.text)) {
        return []
    }

    return setTempValue(temp, [
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [target.text]),
        op(OpCode.ResolveScope),
        op(OpCode.Pop),
    ])
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

const generateArrayElementValue = (
    entryTemp: TempBinding,
    valueTemp: TempBinding,
    doneTemp: TempBinding
): Segment => {
    const whenDone = op(OpCode.Nop, 0)
    const after = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [whenDone]),
        ...getTempValue(doneTemp),
        op(OpCode.JumpIf),
        ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [true])]),
        ...setTempValue(valueTemp, [
            ...getTempValue(entryTemp),
            op(OpCode.EntryGetValue),
        ]),
        ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [false])]),
        op(OpCode.NodeOffset, 2, [after]),
        op(OpCode.Jump),
        whenDone,
        ...setTempValue(valueTemp, [op(OpCode.UndefinedLiteral)]),
        after,
    ]
}

const generateAdvanceIterator = (
    iteratorTemp: TempBinding,
    entryTemp: TempBinding,
    doneTemp: TempBinding
): Segment => {
    const skip = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [skip]),
        ...getTempValue(doneTemp),
        op(OpCode.JumpIf),
        ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [true])]),
        ...setTempValue(entryTemp, [
            ...getTempValue(iteratorTemp),
            op(OpCode.NextEntry),
        ]),
        ...setTempValue(doneTemp, [
            ...getTempValue(entryTemp),
            op(OpCode.EntryIsDone),
        ]),
        skip,
    ]
}

const generateArrayRestIntoTemp = (
    iteratorTemp: TempBinding,
    entryTemp: TempBinding,
    doneTemp: TempBinding,
    valueTemp: TempBinding,
    arrayTemp: TempBinding
): Segment => {
    const loop = op(OpCode.Nop, 0)
    const exit = op(OpCode.Nop, 0)

    return [
        loop,
        ...generateAdvanceIterator(iteratorTemp, entryTemp, doneTemp),
        op(OpCode.NodeOffset, 2, [exit]),
        ...getTempValue(doneTemp),
        op(OpCode.JumpIf),
        ...generateArrayElementValue(entryTemp, valueTemp, doneTemp),
        ...setTempValue(arrayTemp, [
            ...getTempValue(arrayTemp),
            op(OpCode.Duplicate),
            op(OpCode.Literal, 2, ['length']),
            op(OpCode.Get),
            ...getTempValue(valueTemp),
            op(OpCode.SetKeepCtx),
        ]),
        op(OpCode.NodeOffset, 2, [loop]),
        op(OpCode.Jump),
        exit,
    ]
}

const generateIteratorClose = (
    iteratorTemp: TempBinding,
    doneTemp: TempBinding,
    temps: TempState
): Segment => {
    const skip = op(OpCode.Nop, 0)
    const noReturn = op(OpCode.Nop, 0)
    const returnTemp = temps.allocate('binding.return')
    const returnResultTemp = temps.allocate('binding.returnResult')

    return [
        op(OpCode.NodeOffset, 2, [skip]),
        ...getTempValue(doneTemp),
        op(OpCode.JumpIf),
        ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [true])]),
        ...setTempValue(returnTemp, [
            ...getTempValue(iteratorTemp),
            op(OpCode.Literal, 2, ['return']),
            op(OpCode.Get),
        ]),
        op(OpCode.NodeOffset, 2, [noReturn]),
        ...getTempValue(returnTemp),
        op(OpCode.NullLiteral),
        op(OpCode.BEqualsEquals),
        op(OpCode.JumpIf),
        ...getTempValue(iteratorTemp),
        op(OpCode.Literal, 2, ['return']),
        ...getTempValue(returnTemp),
        op(OpCode.Literal, 2, [0]),
        op(OpCode.CallResolved),
        ...setTempValue(returnResultTemp, []),
        ...generateRequireObjectTemp(returnResultTemp),
        noReturn,
        skip,
    ]
}

const generateProtectedIteratorPatternBody = (
    body: Segment,
    iteratorTemp: TempBinding,
    doneTemp: TempBinding,
    temps: TempState,
    ctx: CodegenContext,
    prefix: string
): Segment => {
    const catchName = ctx.allocateInternalName(`${prefix}.error`)
    const closeErrorName = ctx.allocateInternalName(`${prefix}.closeError`)
    const outerCatch = op(OpCode.Nop, 0)
    const outerFinally = op(OpCode.Nop, 0)
    const outerExit = op(OpCode.Nop, 0)
    const innerCatch = op(OpCode.Nop, 0)
    const innerExit = op(OpCode.Nop, 0)

    return [
        op(OpCode.NodeOffset, 2, [outerExit]),
        op(OpCode.NodeOffset, 2, [outerCatch]),
        op(OpCode.NodeOffset, 2, [outerFinally]),
        op(OpCode.Literal, 2, [catchName]),
        op(OpCode.InitTryCatch),
        ...body,
        op(OpCode.ExitTryCatchFinally),
        outerCatch,
        op(OpCode.NodeOffset, 2, [innerExit]),
        op(OpCode.NodeOffset, 2, [innerCatch]),
        op(OpCode.Literal, 2, [-1]),
        op(OpCode.Literal, 2, [closeErrorName]),
        op(OpCode.InitTryCatch),
        ...shiftStaticDepths(generateIteratorClose(iteratorTemp, doneTemp, temps), 1),
        op(OpCode.ExitTryCatchFinally),
        innerCatch,
        op(OpCode.ExitTryCatchFinally),
        innerExit,
        op(OpCode.GetRecord),
        op(OpCode.Literal, 2, [catchName]),
        op(OpCode.Get),
        op(OpCode.Throw),
        outerFinally,
        ...generateIteratorClose(iteratorTemp, doneTemp, temps),
        op(OpCode.ExitTryCatchFinally),
        outerExit,
    ]
}

const generatePropertyNameOps = (name: ts.PropertyName, flag: number, ctx: CodegenContext): Segment => {
    if (ts.isComputedPropertyName(name)) {
        return [
            ...shiftStaticDepths(ctx.generate(name.expression, flag), 1),
            op(OpCode.ToPropertyKey),
        ]
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
        const doneTemp = temps.allocate('binding.done')
        const body: Segment = []

        for (const element of pattern.elements) {
            if (ts.isOmittedExpression(element)) {
                body.push(...generateAdvanceIterator(iteratorTemp, entryTemp, doneTemp))
                continue
            }

            const valueTemp = temps.allocate('binding.value')
            const bindingIdentifier = ts.isIdentifier(element.name) ? element.name : undefined
            const bindingTargetTemp = bindingIdentifier
                ? temps.allocate('binding.ref')
                : undefined

            if (element.dotDotDotToken) {
                if (bindingIdentifier && bindingTargetTemp) {
                    body.push(...captureBindingIdentifierTarget(bindingIdentifier, bindingTargetTemp, ctx))
                }
                body.push(...setTempValue(valueTemp, [op(OpCode.ArrayLiteral)]))
                body.push(...generateArrayRestIntoTemp(iteratorTemp, entryTemp, doneTemp, temps.allocate('binding.restValue'), valueTemp))
                body.push(
                    ...bindingIdentifier
                        ? generateBindingLeafInitialization(bindingIdentifier, valueTemp, ctx, options, bindingTargetTemp)
                        : generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps)
                )
                continue
            }

            if (bindingIdentifier && bindingTargetTemp) {
                body.push(...captureBindingIdentifierTarget(bindingIdentifier, bindingTargetTemp, ctx))
            }
            body.push(...generateAdvanceIterator(iteratorTemp, entryTemp, doneTemp))
            body.push(...generateArrayElementValue(entryTemp, valueTemp, doneTemp))

            if (element.initializer) {
                body.push(...generateApplyDefault(
                    valueTemp,
                    element.initializer,
                    flag,
                    ctx,
                    ts.isIdentifier(element.name) ? element.name.text : undefined
                ))
            }

            body.push(
                ...bindingIdentifier
                    ? generateBindingLeafInitialization(bindingIdentifier, valueTemp, ctx, options, bindingTargetTemp)
                    : generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps)
            )
        }

        return [
            ...setTempValue(iteratorTemp, generateIteratorFromTemp(sourceTemp)),
            ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [false])]),
            ...generateProtectedIteratorPatternBody(body, iteratorTemp, doneTemp, temps, ctx, 'binding'),
            ...generateIteratorClose(iteratorTemp, doneTemp, temps),
        ]
    }

    if (ts.isObjectBindingPattern(pattern)) {
        const ops: Segment = [
            ...generateRequireObjectCoercible(sourceTemp),
        ]
        const excludedKeyTemps: TempBinding[] = []

        for (const element of pattern.elements) {
            const bindingIdentifier = ts.isIdentifier(element.name) ? element.name : undefined
            const bindingTargetTemp = bindingIdentifier
                ? temps.allocate('binding.ref')
                : undefined

            if (element.dotDotDotToken) {
                if (bindingIdentifier && bindingTargetTemp) {
                    ops.push(...captureBindingIdentifierTarget(bindingIdentifier, bindingTargetTemp, ctx))
                }
                const valueTemp = temps.allocate('binding.rest')

                ops.push(...setTempValue(valueTemp, [
                    ...getTempValue(sourceTemp),
                    ...excludedKeyTemps.flatMap((binding) => getTempValue(binding)),
                    op(OpCode.Literal, 2, [excludedKeyTemps.length]),
                    op(OpCode.ObjectRest),
                ]))
                ops.push(
                    ...bindingIdentifier
                        ? generateBindingLeafInitialization(bindingIdentifier, valueTemp, ctx, options, bindingTargetTemp)
                        : generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps)
                )
                continue
            }

            const valueTemp = temps.allocate('binding.value')
            const keyTemp = temps.allocate('binding.key')
            const propertyName = element.propertyName
                ?? (ts.isIdentifier(element.name) ? element.name : undefined)

            if (!propertyName) {
                throw new Error('not support pattern yet')
            }

            ops.push(...setTempValue(keyTemp, generatePropertyNameOps(propertyName, flag, ctx)))
            if (bindingIdentifier && bindingTargetTemp) {
                ops.push(...captureBindingIdentifierTarget(bindingIdentifier, bindingTargetTemp, ctx))
            }
            ops.push(...setTempValue(valueTemp, [
                ...getTempValue(sourceTemp),
                ...getTempValue(keyTemp),
                op(OpCode.Get),
            ]))

            if (element.initializer) {
                ops.push(...generateApplyDefault(
                    valueTemp,
                    element.initializer,
                    flag,
                    ctx,
                    ts.isIdentifier(element.name) ? element.name.text : undefined
                ))
            }

            ops.push(
                ...bindingIdentifier
                    ? generateBindingLeafInitialization(bindingIdentifier, valueTemp, ctx, options, bindingTargetTemp)
                    : generateBindingPatternIntoTemp(element.name, valueTemp, flag, ctx, options, temps)
            )
            excludedKeyTemps.push(keyTemp)
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
        ...(options.initializer
            ? generateApplyDefault(
                sourceTemp,
                options.initializer,
                flag,
                ctx,
                ts.isIdentifier(pattern) ? pattern.text : undefined
            )
            : []),
        ...generateBindingPatternIntoTemp(pattern, sourceTemp, flag, ctx, options, temps),
    ]

    return [
        ...generateSyntheticScopeEnter(tempNames),
        ...setTempValue(sourceTemp, shiftStaticDepths(sourceOps, 1)),
        ...body,
        ...generateSyntheticScopeLeave(),
    ]
}

type AssignmentInitOptions = {
    initializer?: ts.Expression
    preserveResult?: boolean
}

type PreparedAssignmentTarget = {
    capture: Segment
    apply(sourceTemp: TempBinding): Segment
    nameHint?: string
}

const splitAssignmentTarget = (node: ts.Expression): { target: ts.Expression, initializer?: ts.Expression } => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        return {
            target: node.left as ts.Expression,
            initializer: node.right,
        }
    }

    return { target: node }
}

const generateAssignmentLeafInitialization = (
    target: ts.Expression,
    sourceTemp: TempBinding,
    flag: number,
    ctx: CodegenContext
): Segment => {
    const rawTarget = ctx.extractQuote(target)

    if (ts.isIdentifier(rawTarget)) {
        const staticAccess = ctx.tryResolveStaticAccess(rawTarget, rawTarget.text)
        if (staticAccess) {
            const shiftedAccess = shiftStaticAccess(staticAccess, 1)
            return [
                ...getTempValue(sourceTemp),
                ...ctx.generateStaticAccessOps(shiftedAccess),
                op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.SetStaticUnchecked : OpCode.SetStatic),
                op(OpCode.Pop),
            ]
        }
    }

    return [
        ...ctx.generateLeft(target, flag),
        ...(ts.isIdentifier(rawTarget) ? [op(OpCode.ResolveScope)] : []),
        ...getTempValue(sourceTemp),
        op(OpCode.Set),
        op(OpCode.Pop),
    ]
}

const applyPreparedStaticAssignmentTarget = (
    staticAccess: StaticAccess,
    sourceTemp: TempBinding,
    ctx: CodegenContext
): Segment => [
    ...getTempValue(sourceTemp),
    ...ctx.generateStaticAccessOps(shiftStaticAccess(staticAccess, 1)),
    op(ctx.isStaticAccessUnchecked(staticAccess) ? OpCode.SetStaticUnchecked : OpCode.SetStatic),
    op(OpCode.Pop),
]

const prepareAssignmentTarget = (
    target: ts.Expression,
    flag: number,
    ctx: CodegenContext,
    temps: TempState
): PreparedAssignmentTarget | null => {
    const rawTarget = ctx.extractQuote(target)

    if (ts.isIdentifier(rawTarget)) {
        const staticAccess = ctx.tryResolveStaticAccess(rawTarget, rawTarget.text)
        if (staticAccess) {
            return {
                capture: [],
                nameHint: rawTarget.text,
                apply(sourceTemp) {
                    return applyPreparedStaticAssignmentTarget(staticAccess, sourceTemp, ctx)
                },
            }
        }

        const refTemp = temps.allocate('assign.ref')
        return {
            capture: setTempValue(refTemp, [
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [rawTarget.text]),
                op(OpCode.ResolveScope),
                op(OpCode.Pop),
            ]),
            nameHint: rawTarget.text,
            apply(sourceTemp) {
                return [
                    ...getTempValue(refTemp),
                    op(OpCode.Literal, 2, [rawTarget.text]),
                    ...getTempValue(sourceTemp),
                    op(OpCode.Set),
                    op(OpCode.Pop),
                ]
            },
        }
    }

    if (ts.isPropertyAccessExpression(rawTarget)) {
        const baseTemp = temps.allocate('assign.base')
        const nameTemp = temps.allocate('assign.name')
        return {
            capture: [
                ...setTempValue(baseTemp, shiftStaticDepths(ctx.generate(rawTarget.expression, flag), 1)),
                ...setTempValue(nameTemp, [op(OpCode.Literal, 2, [rawTarget.name.text])]),
            ],
            apply(sourceTemp) {
                return [
                    ...getTempValue(baseTemp),
                    ...getTempValue(nameTemp),
                    ...getTempValue(sourceTemp),
                    op(OpCode.Set),
                    op(OpCode.Pop),
                ]
            },
        }
    }

    if (ts.isElementAccessExpression(rawTarget) && rawTarget.argumentExpression != null) {
        const baseTemp = temps.allocate('assign.base')
        const nameTemp = temps.allocate('assign.name')
        return {
            capture: [
                ...setTempValue(baseTemp, shiftStaticDepths(ctx.generate(rawTarget.expression, flag), 1)),
                ...setTempValue(nameTemp, shiftStaticDepths(ctx.generate(rawTarget.argumentExpression, flag), 1)),
            ],
            apply(sourceTemp) {
                return [
                    ...getTempValue(baseTemp),
                    ...getTempValue(nameTemp),
                    ...getTempValue(sourceTemp),
                    op(OpCode.Set),
                    op(OpCode.Pop),
                ]
            },
        }
    }

    return null
}

function generateAssignmentPatternIntoTemp(
    pattern: ts.Expression,
    sourceTemp: TempBinding,
    flag: number,
    ctx: CodegenContext,
    options: AssignmentInitOptions,
    temps: TempState
): Segment {
    const rawPattern = ctx.extractQuote(pattern)

    if (
        ts.isIdentifier(rawPattern)
        || ts.isPropertyAccessExpression(rawPattern)
        || ts.isElementAccessExpression(rawPattern)
        || rawPattern.kind === ts.SyntaxKind.ThisKeyword
    ) {
        const preparedTarget = prepareAssignmentTarget(rawPattern as ts.Expression, flag, ctx, temps)
        const valueTemp = options.initializer ? temps.allocate('assign.value') : sourceTemp
        const ops: Segment = []

        if (preparedTarget) {
            ops.push(...preparedTarget.capture)
        }

        if (options.initializer) {
            ops.push(...setTempValue(valueTemp, getTempValue(sourceTemp)))
            ops.push(...generateApplyDefault(
                valueTemp,
                options.initializer,
                flag,
                ctx,
                preparedTarget?.nameHint ?? (ts.isIdentifier(rawPattern) ? rawPattern.text : undefined)
            ))
        }

        ops.push(
            ...preparedTarget
                ? preparedTarget.apply(valueTemp)
                : generateAssignmentLeafInitialization(rawPattern as ts.Expression, valueTemp, flag, ctx)
        )
        return ops
    }

    if (ts.isArrayLiteralExpression(rawPattern)) {
        const iteratorTemp = temps.allocate('assign.iter')
        const entryTemp = temps.allocate('assign.entry')
        const doneTemp = temps.allocate('assign.done')
        const body: Segment = []

        for (const element of rawPattern.elements) {
            if (ts.isOmittedExpression(element)) {
                body.push(...generateAdvanceIterator(iteratorTemp, entryTemp, doneTemp))
                continue
            }

            const valueTemp = temps.allocate('assign.value')

            if (ts.isSpreadElement(element)) {
                const preparedTarget = prepareAssignmentTarget(element.expression, flag, ctx, temps)
                if (preparedTarget) {
                    body.push(...preparedTarget.capture)
                }
                body.push(...setTempValue(valueTemp, [op(OpCode.ArrayLiteral)]))
                body.push(...generateArrayRestIntoTemp(iteratorTemp, entryTemp, doneTemp, temps.allocate('assign.restValue'), valueTemp))
                body.push(
                    ...preparedTarget
                        ? preparedTarget.apply(valueTemp)
                        : generateAssignmentPatternIntoTemp(element.expression, valueTemp, flag, ctx, {}, temps)
                )
                continue
            }

            const { target, initializer } = splitAssignmentTarget(element)
            const preparedTarget = prepareAssignmentTarget(target, flag, ctx, temps)
            if (preparedTarget) {
                body.push(...preparedTarget.capture)
            }
            body.push(...generateAdvanceIterator(iteratorTemp, entryTemp, doneTemp))
            body.push(...generateArrayElementValue(entryTemp, valueTemp, doneTemp))

            if (initializer) {
                body.push(...generateApplyDefault(
                    valueTemp,
                    initializer,
                    flag,
                    ctx,
                    preparedTarget?.nameHint ?? (ts.isIdentifier(target) ? target.text : undefined)
                ))
            }

            body.push(
                ...preparedTarget
                    ? preparedTarget.apply(valueTemp)
                    : generateAssignmentPatternIntoTemp(target, valueTemp, flag, ctx, {}, temps)
            )
        }

        return [
            ...setTempValue(iteratorTemp, generateIteratorFromTemp(sourceTemp)),
            ...setTempValue(doneTemp, [op(OpCode.Literal, 2, [false])]),
            ...generateProtectedIteratorPatternBody(body, iteratorTemp, doneTemp, temps, ctx, 'assign'),
            ...generateIteratorClose(iteratorTemp, doneTemp, temps),
        ]
    }

    if (ts.isObjectLiteralExpression(rawPattern)) {
        const ops: Segment = [
            ...generateRequireObjectCoercible(sourceTemp),
        ]
        const excludedKeyTemps: TempBinding[] = []

        for (const property of rawPattern.properties) {
            if (ts.isSpreadAssignment(property)) {
                const valueTemp = temps.allocate('assign.rest')
                const preparedTarget = prepareAssignmentTarget(property.expression, flag, ctx, temps)
                if (preparedTarget) {
                    ops.push(...preparedTarget.capture)
                }
                ops.push(...setTempValue(valueTemp, [
                    ...getTempValue(sourceTemp),
                    ...excludedKeyTemps.flatMap((binding) => getTempValue(binding)),
                    op(OpCode.Literal, 2, [excludedKeyTemps.length]),
                    op(OpCode.ObjectRest),
                ]))
                ops.push(
                    ...preparedTarget
                        ? preparedTarget.apply(valueTemp)
                        : generateAssignmentPatternIntoTemp(property.expression, valueTemp, flag, ctx, {}, temps)
                )
                continue
            }

            const valueTemp = temps.allocate('assign.value')
            const keyTemp = temps.allocate('assign.key')

            if (ts.isShorthandPropertyAssignment(property)) {
                const preparedTarget = prepareAssignmentTarget(property.name, flag, ctx, temps)
                ops.push(...setTempValue(keyTemp, [op(OpCode.Literal, 2, [property.name.text])]))
                if (preparedTarget) {
                    ops.push(...preparedTarget.capture)
                }
                ops.push(...setTempValue(valueTemp, [
                    ...getTempValue(sourceTemp),
                    ...getTempValue(keyTemp),
                    op(OpCode.Get),
                ]))

                if (property.objectAssignmentInitializer) {
                    ops.push(...generateApplyDefault(
                        valueTemp,
                        property.objectAssignmentInitializer,
                        flag,
                        ctx,
                        preparedTarget?.nameHint ?? property.name.text
                    ))
                }

                ops.push(
                    ...preparedTarget
                        ? preparedTarget.apply(valueTemp)
                        : generateAssignmentPatternIntoTemp(property.name, valueTemp, flag, ctx, {}, temps)
                )
                excludedKeyTemps.push(keyTemp)
                continue
            }

            if (!ts.isPropertyAssignment(property)) {
                throw new Error('not support pattern yet')
            }

            const { target, initializer } = splitAssignmentTarget(property.initializer)
            const preparedTarget = prepareAssignmentTarget(target, flag, ctx, temps)
            ops.push(...setTempValue(keyTemp, generatePropertyNameOps(property.name, flag, ctx)))
            if (preparedTarget) {
                ops.push(...preparedTarget.capture)
            }
            ops.push(...setTempValue(valueTemp, [
                ...getTempValue(sourceTemp),
                ...getTempValue(keyTemp),
                op(OpCode.Get),
            ]))

            if (initializer) {
                ops.push(...generateApplyDefault(
                    valueTemp,
                    initializer,
                    flag,
                    ctx,
                    preparedTarget?.nameHint ?? (ts.isIdentifier(target) ? target.text : undefined)
                ))
            }

            ops.push(
                ...preparedTarget
                    ? preparedTarget.apply(valueTemp)
                    : generateAssignmentPatternIntoTemp(target, valueTemp, flag, ctx, {}, temps)
            )
            excludedKeyTemps.push(keyTemp)
        }

        return ops
    }

    throw new Error('not support pattern yet')
}

export function generateAssignmentPattern(
    pattern: ts.Expression,
    sourceOps: Segment,
    flag: number,
    ctx: CodegenContext,
    options: AssignmentInitOptions = {}
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

    const sourceTemp = temps.allocate('assign.source')
    const body: Segment = [
        ...(options.initializer
            ? generateApplyDefault(
                sourceTemp,
                options.initializer,
                flag,
                ctx,
                ts.isIdentifier(pattern) ? pattern.text : undefined
            )
            : []),
        ...generateAssignmentPatternIntoTemp(pattern, sourceTemp, flag, ctx, options, temps),
        ...(options.preserveResult ? getTempValue(sourceTemp) : []),
    ]

    return [
        ...generateSyntheticScopeEnter(tempNames),
        ...setTempValue(sourceTemp, shiftStaticDepths(sourceOps, 1)),
        ...body,
        ...generateSyntheticScopeLeave(),
    ]
}
