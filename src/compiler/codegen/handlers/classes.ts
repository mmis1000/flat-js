import * as ts from 'typescript'

import { FunctionTypes, OpCode, SpecialVariable, VariableType } from '../../shared'
import { createNodeFunctionTypeDefinePair, markInternals, op } from '../helpers'
import type { CodegenContext } from '../context'
import type { Segment } from '../types'

export function generateClasses(node: ts.Node, flag: number, ctx: CodegenContext): Segment | undefined {
    if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) {
        return
    }

    const className = node.name?.text ?? ''
    const extendsClause = node.heritageClauses?.find(
        (clause: ts.HeritageClause) => clause.token === ts.SyntaxKind.ExtendsKeyword
    )
    const superExpr = extendsClause?.types[0]?.expression
    const hasSuper = superExpr !== undefined

    const ctorMember = node.members.find(
        (member: ts.ClassElement) => ts.isConstructorDeclaration(member)
    ) as ts.ConstructorDeclaration | undefined

    const res: Segment = []

    if (hasSuper) {
        res.push(
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            op(OpCode.Literal, 2, [VariableType.Var]),
            op(OpCode.Literal, 2, [1]),
            op(OpCode.EnterScope)
        )
        res.push(
            op(OpCode.GetRecord),
            op(OpCode.Literal, 2, [SpecialVariable.Super]),
            ...ctx.generate(superExpr!, flag),
            op(OpCode.SetInitialized),
            op(OpCode.Pop)
        )
    }

    if (ctorMember) {
        const [functionType, defineFunction] = createNodeFunctionTypeDefinePair(ctorMember)
        res.push(
            op(OpCode.Literal, 2, [className]),
            op(OpCode.NodeOffset, 2, [ctorMember]),
            functionType,
            defineFunction
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
        res.push(op(OpCode.NullLiteral))
    }

    res.push(op(OpCode.Literal, 2, [className]))
    res.push(op(OpCode.CreateClass))

    for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) continue

        const isStatic = ts.canHaveModifiers(member) ? (
            member.modifiers?.some((modifier: ts.Modifier | ts.ModifierLike) => modifier.kind === ts.SyntaxKind.StaticKeyword) ?? false
        ) : false

        if (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
            const [functionType, defineFunction] = createNodeFunctionTypeDefinePair(member)
            res.push(op(OpCode.Duplicate))
            if (!isStatic) {
                res.push(
                    op(OpCode.Literal, 2, ['prototype']),
                    op(OpCode.Get)
                )
            }

            if (ts.isComputedPropertyName(member.name)) {
                res.push(...ctx.generate(member.name.expression, flag))
            } else if (ts.isIdentifier(member.name)) {
                res.push(op(OpCode.Literal, 2, [member.name.text]))
            } else if (ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) {
                res.push(...ctx.generate(member.name, flag))
            } else {
                throw new Error('unsupported class member name')
            }

            res.push(op(OpCode.Duplicate))
            res.push(op(OpCode.NodeOffset, 2, [member]))
            res.push(functionType)
            res.push(defineFunction)

            if (ts.isGetAccessorDeclaration(member)) {
                res.push(op(OpCode.DefineGetter))
            } else if (ts.isSetAccessorDeclaration(member)) {
                res.push(op(OpCode.DefineSetter))
            } else {
                res.push(op(OpCode.DefineMethod))
            }

            res.push(op(OpCode.Pop))
        }
    }

    if (hasSuper) {
        res.push(op(OpCode.LeaveScope))
    }

    if (ts.isClassDeclaration(node) && node.name) {
        return [
            ...ctx.generateLeft(node.name, flag),
            ...res,
            op(OpCode.SetInitialized),
            op(OpCode.Pop),
            ...markInternals([
                ...ctx.generateLeft(node.name, flag),
                op(OpCode.FreezeVariable),
                op(OpCode.Pop),
                op(OpCode.Pop)
            ])
        ]
    }

    return res
}
