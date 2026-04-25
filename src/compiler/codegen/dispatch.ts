import * as ts from 'typescript'

import { getNameOfKind } from './helpers'
import type { CodegenContext } from './context'
import type { CodegenHandler, Segment } from './types'
import { generateBasics } from './handlers/basics'
import { generateFunctions } from './handlers/functions'
import { generateOperators } from './handlers/operators'
import { generateCallsAndAccess } from './handlers/calls-access'
import { generateControlFlow } from './handlers/control-flow'
import { generateLoops } from './handlers/loops'
import { generateClasses } from './handlers/classes'
import { generateAsyncTemplate } from './handlers/async-template'

const handlers: CodegenHandler[] = [
    generateBasics,
    generateFunctions,
    generateOperators,
    generateCallsAndAccess,
    generateControlFlow,
    generateLoops,
    generateClasses,
    generateAsyncTemplate,
]

export function dispatchGenerate(node: ts.Node, flag: number, ctx: CodegenContext): Segment {
    for (const handler of handlers) {
        const result = handler(node, flag, ctx)
        if (result !== undefined) {
            return result
        }
    }

    throw new Error(`Unknown node ${getNameOfKind(node.kind)}`)
}
