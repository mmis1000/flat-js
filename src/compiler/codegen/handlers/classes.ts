import * as ts from 'typescript'

import { FunctionTypes, OpCode, SpecialVariable } from '../../shared'
import { generateFunctionDefinitionWithStackName, getExpectedArgumentCount } from './functions'
import { generateEnterScope, markInternals, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

function getStaticPropertyName(name: ts.Identifier | ts.StringLiteral | ts.NumericLiteral): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        return name.text
    }
    return String(Number(name.text))
}

export function generateClassValue(
    node: ts.ClassDeclaration | ts.ClassExpression,
    flag: number,
    ctx: CodegenContext,
    nameOverride?: string,
    nameFromStack: boolean = false
): Segment {
    const className = nameOverride ?? node.name?.text ?? ''
    const usesStackName = nameFromStack && node.name == null
    const extendsClause = node.heritageClauses?.find(
        (clause: ts.HeritageClause) => clause.token === ts.SyntaxKind.ExtendsKeyword
    )
    const superExpr = extendsClause?.types[0]?.expression
    const hasSuper = superExpr !== undefined
    const classBindingName = node.name?.text
    const classBindingAccess = classBindingName != null && node.name != null
        ? ctx.tryResolveStaticAccess(node.name, classBindingName)
        : null
    const hasClassScope = classBindingName != null || hasSuper

    const ctorMember = node.members.find(
        (member: ts.ClassElement) => ts.isConstructorDeclaration(member)
    ) as ts.ConstructorDeclaration | undefined

    const res: Segment = []

    if (hasClassScope) {
        res.push(...generateEnterScope(node, ctx.scopes, ctx.getVariableRuntimeName))
    }

    if (classBindingName != null) {
        if (classBindingAccess != null) {
            res.push(
                ...markInternals([
                    ...ctx.generateStaticAccessOps(classBindingAccess),
                    op(OpCode.FreezeVariableStatic),
                ])
            )
        } else {
            res.push(
                op(OpCode.GetRecord),
                op(OpCode.Literal, 2, [classBindingName]),
                op(OpCode.FreezeVariable)
            )
        }
    }

    if (hasSuper) {
        res.push(
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            ...ctx.generate(superExpr!, flag),
            op(OpCode.SetInitialized),
            op(OpCode.Pop)
        )
    }

    if (ctorMember) {
        if (usesStackName) {
            res.push(op(OpCode.Duplicate))
        } else {
            res.push(op(OpCode.Literal, 2, [className]))
        }
        res.push(
            op(OpCode.Literal, 2, [getExpectedArgumentCount(ctorMember)]),
            op(OpCode.NodeOffset, 2, [ctorMember]),
            op(OpCode.NodeOffset, 2, [ctorMember, 'bodyStart']),
            op(OpCode.Literal, 2, [hasSuper ? FunctionTypes.DerivedConstructor : FunctionTypes.Constructor]),
            op(OpCode.DefineFunction)
        )
    } else {
        res.push(op(OpCode.UndefinedLiteral))
    }

    if (hasSuper) {
        res.push(
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            op(OpCode.Get)
        )
    } else {
        res.push(op(OpCode.UndefinedLiteral))
    }

    res.push(usesStackName ? op(OpCode.UndefinedLiteral) : op(OpCode.Literal, 2, [className]))
    res.push(op(OpCode.CreateClass))

    if (classBindingName != null) {
        if (classBindingAccess != null) {
            res.push(
                op(OpCode.Duplicate),
                ...ctx.generateStaticAccessOps(classBindingAccess),
                op(OpCode.SetInitializedStatic),
                op(OpCode.Pop)
            )
        } else {
            res.push(op(OpCode.SetInitialized))
        }
    }

    for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) continue

        const isStatic = ts.canHaveModifiers(member) ? (
            member.modifiers?.some((modifier: ts.Modifier | ts.ModifierLike) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false
        ) : false

        if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
            res.push(op(OpCode.Duplicate))
            if (!isStatic) {
                res.push(
                    op(OpCode.Literal, 2, ['prototype']),
                    op(OpCode.Get)
                )
            }

            if (ts.isComputedPropertyName(member.name)) {
                res.push(...ctx.generate(member.name.expression, flag))
                res.push(op(OpCode.ToPropertyKey))
            } else if (ts.isIdentifier(member.name)) {
                res.push(op(OpCode.Literal, 2, [member.name.text]))
            } else if (ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) {
                res.push(op(OpCode.Literal, 2, [getStaticPropertyName(member.name)]))
            } else {
                throw new Error('unsupported class member name')
            }

            res.push(op(OpCode.Duplicate))
            res.push(...generateFunctionDefinitionWithStackName(member))

            if (ts.isGetAccessorDeclaration(member)) {
                res.push(op(OpCode.Literal, 2, [0]))
                res.push(op(OpCode.DefineGetter))
            } else if (ts.isSetAccessorDeclaration(member)) {
                res.push(op(OpCode.Literal, 2, [0]))
                res.push(op(OpCode.DefineSetter))
            } else {
                res.push(op(OpCode.Literal, 2, [0]))
                res.push(op(OpCode.DefineMethod))
            }

            res.push(op(OpCode.Pop))
        }
    }

    if (hasClassScope) {
        res.push(op(OpCode.LeaveScope))
    }

    return res
}

export function generateClasses(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) {
        return
    }

    const res = generateClassValue(node, flag, ctx)

    if (ts.isClassDeclaration(node) && node.name) {
        return [
            ...ctx.generateLeft(node.name, flag),
            ...res,
            op(OpCode.SetInitialized),
            op(OpCode.Pop)
        ]
    }

    return res
}
