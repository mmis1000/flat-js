export const TEXT_DADA_MASK = 0x80000000

export const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}

/** Literal pool tail entries: `[label, length, ...payload]` (`length` = payload word count). MUST SYNC with runtime `decodeLiteralFromProgram`. */
export const enum LiteralPoolKind {
    Boolean = 1,
    Number = 2,
    String = 3,
}

/** XOR mask for each pool word at absolute program index `i` (position-dependent). MUST SYNC with runtime `literalPoolWordMask`. */
export const literalPoolWordMask = (i: number): number => {
    const x = (i * 0x9e3779b9 | 0) ^ (i >>> 1) ^ (i << 3)
    return (x ^ (x >>> 15) ^ (x << 15)) | 0
}

export const enum SpecialVariable {
    This = '[this]',
    SwitchValue = '[switch]',
    LoopIterator = '[iter]',
    IteratorEntry = '[entry]',
    Super = '[super]',
    NewTarget = '[newTarget]',
}

export const enum StatementFlag {
    Try              = 1 << 0,
    Catch            = 1 << 1,
    Finally          = 1 << 2,
    TryCatchFlags = Try | Catch | Finally,
    Eval             = 1 << 3,
}

export const enum TryCatchFinallyState {
    Try,
    Catch,
    Finally
}

export const enum ResultType {
    Normal,
    Return,
    Throw,
    Break
}

export const enum VariableType {
    Var = 1,
    Let = 2,
    Const = 3,
    Parameter = 4,
    Function = 5,
}

export const enum SetFlag {
    DeTDZ = 1,
    Freeze = 2
}

export const enum InvokeType {
    Apply,
    Construct,
    Generator
}

export type ProgramScopeDebugMap = Map<number, readonly string[]>

export const enum OpCode {
    Nop,
    Literal,
    NullLiteral,
    UndefinedLiteral,

    NodeOffset,
    NodeFunctionType,
    JumpIfNot,
    JumpIf,
    Jump,
    JumpIfAndKeep,
    JumpIfNotAndKeep,

    EnterFunction,
    EnterScope,
    LeaveScope,

    Pop,
    SetEvalResult,
    Duplicate,

    GetRecord,
    GetStatic,
    GetStaticUnchecked,
    SetInitialized,
    SetInitializedStatic,
    Set,
    SetStatic,
    SetStaticUnchecked,
    SetKeepCtx,
    SetMultiple,
    DefineKeepCtx,
    Get,
    DeTDZ,
    DeTDZStatic,
    FreezeVariable,
    FreezeVariableStatic,

    DefineFunction,
    Return,
    ReturnInTryCatchFinally,
    Throw,
    ThrowInTryCatchFinally,
    BreakInTryCatchFinally,
    ExitTryCatchFinally,
    InitTryCatch,

    Call,
    CallAsEval,
    New,
    CallValue,

    Typeof,
    TypeofReference,
    TypeofStaticReference,
    TypeofStaticReferenceUnchecked,

    InstanceOf,
    GetPropertyIterator,
    NextEntry,
    EntryIsDone,
    EntryGetValue,
    ArrayLiteral,
    ObjectLiteral,
    RegexpLiteral,

    BIn,
    BPlus,
    BMinus,
    BCaret,
    BAmpersand,
    BBar,
    BGreaterThan,
    BGreaterThanGreaterThan,
    BGreaterThanGreaterThanGreaterThan,
    BGreaterThanEquals,
    BLessThan,
    BLessThanLessThan,
    BLessThanEquals,
    BEqualsEquals,
    BEqualsEqualsEquals,
    BExclamationEquals,
    BExclamationEqualsEquals,
    BAsterisk,
    BSlash,
    BPercent,

    BPlusEqual,
    BPlusEqualStatic,
    BPlusEqualStaticUnchecked,
    BMinusEqual,
    BMinusEqualStatic,
    BMinusEqualStaticUnchecked,
    BSlashEqual,
    BSlashEqualStatic,
    BSlashEqualStaticUnchecked,
    BAsteriskEqual,
    BAsteriskEqualStatic,
    BAsteriskEqualStaticUnchecked,

    Delete,
    ThrowReferenceError,

    PostFixMinusMinus,
    PostFixMinusMinusStatic,
    PostFixMinusMinusStaticUnchecked,
    PostFixPlusPLus,
    PostFixPlusPLusStatic,
    PostFixPlusPLusStaticUnchecked,
    PrefixUnaryPlus,
    PrefixUnaryMinus,
    PrefixExclamation,
    PrefixTilde,

    PrefixPlusPlus,
    PrefixPlusPlusStatic,
    PrefixPlusPlusStaticUnchecked,
    PrefixMinusMinus,
    PrefixMinusMinusStatic,
    PrefixMinusMinusStaticUnchecked,

    Debugger,

    CreateClass,
    DefineMethod,
    DefineGetter,
    DefineSetter,

    Yield,
    YieldResume,
    YieldStar,
    Await,

    SuperCall,
    ArraySpread,

    /** Pops a number from the value stack and sets it as the current blockSeed. 1-word. MUST SYNC with runtime. */
    Reseed,

    // Aliases — same handler as their base opcode, for frequency-analysis resistance
    LiteralAlias1,
    LiteralAlias2,
    GetAlias1,
    SetAlias1,
    PopAlias1,
    JumpAlias1,
    JumpIfNotAlias1,
    GetRecordAlias1,
    DuplicateAlias1,

    /** Sentinel — must remain last. Domain size for Fisher-Yates shuffle. */
    _COUNT,
}

export const enum ResolveType {
    normal,
    throw,
    return,
    break
}

export const enum FunctionTypes {
    SourceFile,
    SourceFileInPlace,
    FunctionDeclaration,
    FunctionExpression,
    ArrowFunction,
    MethodDeclaration,
    GetAccessor,
    SetAccessor,
    Constructor,
    GeneratorDeclaration,
    GeneratorExpression,
    GeneratorMethod,
    AsyncFunctionDeclaration,
    AsyncFunctionExpression,
    AsyncArrowFunction,
    AsyncMethod,
    DerivedConstructor,
}
