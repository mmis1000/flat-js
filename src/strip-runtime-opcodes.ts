import * as ts from 'typescript'

function caseClauseNumbers(clause: ts.CaseClause): number[] {
    const e = clause.expression
    if (ts.isNumericLiteral(e)) {
        return [Number(e.text)]
    }
    if (
        ts.isPrefixUnaryExpression(e)
        && e.operator === ts.SyntaxKind.MinusToken
        && ts.isNumericLiteral(e.operand)
    ) {
        return [-Number(e.operand.text)]
    }
    return []
}

function stripCommandSwitch(sw: ts.SwitchStatement, keepOpcodeValues: Set<number>): ts.SwitchStatement {
    const clauses = sw.caseBlock.clauses
    const out: ts.CaseOrDefaultClause[] = []
    let i = 0
    while (i < clauses.length) {
        const c = clauses[i]
        if (ts.isDefaultClause(c)) {
            out.push(c)
            i++
            continue
        }
        if (!ts.isCaseClause(c)) {
            i++
            continue
        }
        const group: ts.CaseClause[] = []
        let cur: ts.CaseOrDefaultClause | undefined = clauses[i]
        while (
            cur !== undefined
            && ts.isCaseClause(cur)
            && cur.statements.length === 0
        ) {
            group.push(cur)
            i++
            cur = clauses[i]
        }
        if (cur !== undefined && ts.isCaseClause(cur)) {
            group.push(cur)
            i++
        }
        const nums = group.flatMap(caseClauseNumbers)
        const keepGroup = nums.length === 0 || nums.some(n => keepOpcodeValues.has(n))
        if (keepGroup) {
            out.push(...group)
        }
    }
    return ts.factory.updateSwitchStatement(
        sw,
        sw.expression,
        ts.factory.updateCaseBlock(sw.caseBlock, out)
    )
}

/**
 * Removes `case` arms from the compiled runtime's `command: switch` when the opcode
 * value is not in `keepOpcodeValues`. Preserves `default` and non-numeric cases.
 */
export function stripRuntimeCommandSwitch(source: string, keepOpcodeValues: Set<number>): string {
    const sf = ts.createSourceFile('runtime.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    const transformer = (context: ts.TransformationContext): ts.Transformer<ts.SourceFile> => {
        const visitor = (node: ts.Node): ts.Node => {
            if (
                ts.isLabeledStatement(node)
                && node.label.text === 'command'
                && ts.isSwitchStatement(node.statement)
            ) {
                const stripped = stripCommandSwitch(node.statement, keepOpcodeValues)
                return ts.factory.updateLabeledStatement(node, node.label, stripped)
            }
            return ts.visitEachChild(node, visitor, context)
        }
        return file => ts.visitNode(file, visitor) as ts.SourceFile
    }
    const tr = ts.transform(sf, [transformer])
    try {
        const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed })
        return printer.printFile(tr.transformed[0])
    } finally {
        tr.dispose()
    }
}
