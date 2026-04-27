export {
    getProgramMetadataStart,
    getProgramSeedWord,
    getProtectedProgramCodeLength,
    isProtectedModeProgram,
    PROGRAM_PROTECTED_MODE_METADATA_WORDS,
    PROGRAM_PROTECTED_MODE_TRAILER,
    TEXT_DADA_MASK,
    isSmallNumber,
    LiteralPoolKind,
    literalPoolWordMask,
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
