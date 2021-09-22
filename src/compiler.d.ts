import * as ts from 'typescript';
export declare const TEXT_DADA_MASK = 2147483648;
export declare const isSmallNumber: (a: any) => a is number;
export declare const enum SpecialVariable {
    This = "[this]",
    SwitchValue = "[switch]",
    LoopIterator = "[iter]",
    IteratorEntry = "[entry]"
}
export declare const enum StatementFlag {
    Try = 1,
    Catch = 2,
    Finally = 4,
    TryCatchFlags = 7,
    Eval = 8
}
export declare const enum TryCatchFinallyState {
    Try = 0,
    Catch = 1,
    Finally = 2
}
export declare const enum ResultType {
    Normal = 0,
    Return = 1,
    Throw = 2,
    Break = 3
}
export declare const enum VariableType {
    Var = 1,
    Let = 2,
    Const = 3,
    Parameter = 4,
    Function = 5
}
export declare const enum SetFlag {
    DeTDZ = 1,
    Freeze = 2
}
export declare const enum InvokeType {
    Apply = 0,
    Construct = 1
}
export declare const enum OpCode {
    Nop = 0,
    Literal = 1,
    NullLiteral = 2,
    UndefinedLiteral = 3,
    NodeOffset = 4,
    NodeFunctionType = 5,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * ```
     */
    JumpIfNot = 6,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * ```
     */
    JumpIf = 7,
    Jump = 8,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * Result
     *   condition
     * ```
     */
    JumpIfAndKeep = 9,
    /**
     * ```txt
     * Stack:
     *   offset
     *   condition
     * Result
     *   condition
     * ```
     */
    JumpIfNotAndKeep = 10,
    /**
     * ```txt
     * Stack:
     *   this
     *   function
     *   function name
     *   InvokeType.Apply
     *   parameter * O
     *   parameter count: O
     *   parameter name * N - reversed
     *   parameter name count: N
     *   [
     *     variable name
     *     variable type
     *   ] * M
     *   variable count: M
     *   function type
     *
     * or
     *
     * Stack:
     *   newTarget
     *   constructor
     *   constructor name
     *   InvokeType.Construct
     *   parameter * O
     *   parameter count: O
     *   parameter name * N - reversed
     *   parameter name count: N
     *   [
     *     variable name
     *     variable type
     *   ] * M
     *   variable count: M
     *   function type
     *
     * ```
    */
    EnterFunction = 11,
    /**
     * ```txt
     * Stack:
     *   [
     *     variable name
     *     variable type
     *   ] * M
     *   variable count: M
     * ```
    */
    EnterScope = 12,
    LeaveScope = 13,
    Pop = 14,
    SetEvalResult = 15,
    /**
     * ```txt
     * Stack:
     *   item
     * Result:
     *   item
     *   item
     */
    Duplicate = 16,
    /** RTL, foo = bar, var foo = bar */
    GetRecord = 17,
    /**
     * ```txt
     * Stack:
     *   env
     *   name
     *   value
     * Result:
     *   value
     * ```
     */
    SetInitialized = 18,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   value
     * Result:
     *   value
     * ```
     */
    Set = 19,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   value
     * Result:
     *   env or object
     * ```
     */
    SetKeepCtx = 20,
    /**
     * ```txt
     * Stack:
     *   [
     *     name
     *     value
     *     setFlag
     *   ] * M
     *   itemCount - M
     *   env or object
     * Result:
     *   env or object
     * ```
     */
    SetMultiple = 21,
    /**
     * ```txt
     * Stack:
     *   object
     *   name
     *   value
     * Result:
     *   env or object
     * ```
     */
    DefineKeepCtx = 22,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     * ```
    */
    Get = 23,
    /**
     * ```txt
     * Stack:
     *   env or object // no consume
     *   name // no consume
     * ```
    */
    DeTDZ = 24,
    /**
     * ```txt
     * Stack:
     *   env or object // no consume
     *   name // no consume
     * ```
    */
    FreezeVariable = 25,
    /**
     * ```tst
     * Stack:
     *   name
     *   nodeOffset
     *   nodeFunctionType
     * ```
     */
    DefineFunction = 26,
    Return = 27,
    /**
     * ```tst
     * Stack:
     *   Value
     * ```
     */
    ReturnInTryCatchFinally = 28,
    /**
     * ```tst
     * Stack:
     *   Value
     * ```
     */
    Throw = 29,
    /**
     * ```tst
     * Stack:
     *   Value
     * ```
     */
    ThrowInTryCatchFinally = 30,
    /**
     * ```tst
     * Stack:
     *   Depth
     *   Addr
     * ```
     */
    BreakInTryCatchFinally = 31,
    /**
     * ```tst
     * Stack:
     *   TryCatchFinallyState
     *   ReturnType
     *   Value
     * ```
     */
    ExitTryCatchFinally = 32,
    /**
     * ```tst
     * Stack:
     *   Exit
     *   CatchAddress
     *   FinallyAddress
     *   CatchClauseName
     * ```
     */
    InitTryCatch = 33,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   argument * M
     *   argument count - M
     * ```
     */
    Call = 34,
    /**
     * ```txt
     * Same as call except allow to read local scope
     * Stack:
     *   env or object
     *   name
     *   argument * M
     *   argument count - M
     * ```
     */
    CallAsEval = 35,
    /**
     * ```txt
     * Stack:
     *   fn
     *   argument * M
     *   argument count - M
     * ```
     */
    New = 36,
    /**
     * ```txt
     * Stack:
     *   fn
     *   argument * M
     *   argument count - M
     * ```
     */
    CallValue = 37,
    /**
     * ```txt
     * Stack:
     *   value
     * ```
     */
    Typeof = 38,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     * ```
     */
    TypeofReference = 39,
    /**
     * ```txt
     * Stack:
     *   value left
     *   value right
     * ```
     */
    InstanceOf = 40,
    /**
     * ```txt
     * Stack:
     *   value
     * Result:
     *   iterator
     * ```
     */
    GetPropertyIterator = 41,
    /**
     * ```txt
     * Stack:
     *   iterator
     * Result:
     *   entry
     * ```
     */
    NextEntry = 42,
    /**
     * ```txt
     * Stack:
     *   iterator entry
     * Result:
     *   boolean - done
     * ```
     */
    EntryIsDone = 43,
    /**
     * ```txt
     * Stack:
     *   iterator entry
     * Result:
     *   value
     * ```
     */
    EntryGetValue = 44,
    /**
     * ```txt
     * Stack:
     * ```
     */
    ArrayLiteral = 45,
    /**
     * ```txt
     * Stack:
     * ```
     */
    ObjectLiteral = 46,
    /**
     * ```txt
     * Stack:
     *   Source
     *   Flags
     * ```
     */
    RegexpLiteral = 47,
    /** in */
    BIn = 48,
    /** + */
    BPlus = 49,
    /** - */
    BMinus = 50,
    /** ^ */
    BCaret = 51,
    /** & */
    BAmpersand = 52,
    /** | */
    BBar = 53,
    /** > */
    BGreaterThan = 54,
    /** >> */
    BGreaterThanGreaterThan = 55,
    /** >>> */
    BGreaterThanGreaterThanGreaterThan = 56,
    /** >= */
    BGreaterThanEquals = 57,
    /** < */
    BLessThan = 58,
    /** << */
    BLessThanLessThan = 59,
    /** <= */
    BLessThanEquals = 60,
    /** == */
    BEqualsEquals = 61,
    /** === */
    BEqualsEqualsEquals = 62,
    /** != */
    BExclamationEquals = 63,
    /** !== */
    BExclamationEqualsEquals = 64,
    /** * */
    BAsterisk = 65,
    /** / */
    BSlash = 66,
    /** % */
    BPercent = 67,
    /** += */
    BPlusEqual = 68,
    /** -= */
    BMinusEqual = 69,
    /** /= */
    BSlashEqual = 70,
    /** *= */
    BAsteriskEqual = 71,
    /**
     * Stack:
     *   env or object
     *   name
     */
    Delete = 72,
    /**
     * ```txt
     * a--
     * Stack:
     *   env or object
     *   name
     * ```
     *
    */
    /**
     * ```txt
     * Stack:
     *   message
     * ```
     *
    */
    ThrowReferenceError = 73,
    PostFixMinusMinus = 74,
    /**
     * ```txt
     * a++
     * Stack:
     *   env or object
     *   name
     * ```
     */
    PostFixPlusPLus = 75,
    PrefixUnaryPlus = 76,
    PrefixUnaryMinus = 77,
    PrefixExclamation = 78,
    PrefixTilde = 79,
    PrefixPlusPlus = 80,
    PrefixMinusMinus = 81,
    /**
     * debugger;
     */
    Debugger = 82
}
export declare const enum ResolveType {
    normal = 0,
    throw = 1,
    return = 2,
    break = 3
}
export declare const enum FunctionTypes {
    SourceFile = 0,
    SourceFileInPlace = 1,
    FunctionDeclaration = 2,
    FunctionExpression = 3,
    ArrowFunction = 4,
    MethodDeclaration = 5,
    GetAccessor = 6,
    SetAccessor = 7,
    Constructor = 8
}
export declare function getNameOfKind(kind: ts.SyntaxKind): string;
export declare type CompileOptions = {
    /** prints debug info to stdout */
    debug?: boolean;
    /** generate sourcemap */
    range?: boolean;
    /** generate with eval result op inserted */
    evalMode?: boolean;
};
export declare type DebugInfo = {
    sourceMap: [number, number, number, number][];
    internals: boolean[];
};
export declare function compile(src: string, { debug, range, evalMode }?: CompileOptions): [number[], any[], DebugInfo];
