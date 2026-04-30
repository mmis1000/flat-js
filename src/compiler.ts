export {
    TEXT_DADA_MASK,
    STATIC_SLOT_NAMELESS,
    isSmallNumber,
    LiteralPoolKind,
    SpecialVariable,
    StatementFlag,
    TryCatchFinallyState,
    ResultType,
    VariableType,
    SetFlag,
    InvokeType,
    OpCode,
    ResolveType,
    FunctionTypes,
    type ProgramScopeDebugMap,
} from './compiler/shared'

export { compile, type CompileOptions, type DebugInfo } from './compiler/compile'
export { collectUsedOpcodes } from './compiler/encoding'
export { getNameOfKind } from './compiler/codegen/helpers'
