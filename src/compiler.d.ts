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
    Throw = 2
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
     *   TryCatchFinallyState
     *   ReturnType
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
     *   TryCatchFinallyState
     *   ReturnType
     *   Value
     * ```
     */
    ThrowInTryCatchFinally = 30,
    /**
     * ```tst
     * Stack:
     *   TryCatchFinallyState
     *   ReturnType
     *   Value
     * ```
     */
    ExitTryCatchFinally = 31,
    /**
     * ```tst
     * Stack:
     *   Exit
     *   CatchAddress
     *   FinallyAddress
     *   CatchClauseName
     * ```
     */
    InitTryCatch = 32,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     *   argument * M
     *   argument count - M
     * ```
     */
    Call = 33,
    /**
     * ```txt
     * Stack:
     *   fn
     *   argument * M
     *   argument count - M
     * ```
     */
    New = 34,
    /**
     * ```txt
     * Stack:
     *   fn
     *   argument * M
     *   argument count - M
     * ```
     */
    CallValue = 35,
    /**
     * ```txt
     * Stack:
     *   value
     * ```
     */
    Typeof = 36,
    /**
     * ```txt
     * Stack:
     *   env or object
     *   name
     * ```
     */
    TypeofReference = 37,
    /**
     * ```txt
     * Stack:
     *   value left
     *   value right
     * ```
     */
    InstanceOf = 38,
    /**
     * ```txt
     * Stack:
     *   value
     * Result:
     *   iterator
     * ```
     */
    GetPropertyIterator = 39,
    /**
     * ```txt
     * Stack:
     *   iterator
     * Result:
     *   entry
     * ```
     */
    NextEntry = 40,
    /**
     * ```txt
     * Stack:
     *   iterator entry
     * Result:
     *   boolean - done
     * ```
     */
    EntryIsDone = 41,
    /**
     * ```txt
     * Stack:
     *   iterator entry
     * Result:
     *   value
     * ```
     */
    EntryGetValue = 42,
    /**
     * ```txt
     * Stack:
     * ```
     */
    ArrayLiteral = 43,
    /**
     * ```txt
     * Stack:
     * ```
     */
    ObjectLiteral = 44,
    /**
     * ```txt
     * Stack:
     *   Source
     *   Flags
     * ```
     */
    RegexpLiteral = 45,
    /** in */
    BIn = 46,
    /** + */
    BPlus = 47,
    /** - */
    BMinus = 48,
    /** ^ */
    BCaret = 49,
    /** & */
    BAmpersand = 50,
    /** | */
    BBar = 51,
    /** > */
    BGreaterThan = 52,
    /** >> */
    BGreaterThanGreaterThan = 53,
    /** >>> */
    BGreaterThanGreaterThanGreaterThan = 54,
    /** >= */
    BGreaterThanEquals = 55,
    /** < */
    BLessThan = 56,
    /** << */
    BLessThanLessThan = 57,
    /** <= */
    BLessThanEquals = 58,
    /** == */
    BEqualsEquals = 59,
    /** === */
    BEqualsEqualsEquals = 60,
    /** != */
    BExclamationEquals = 61,
    /** !== */
    BExclamationEqualsEquals = 62,
    /** * */
    BAsterisk = 63,
    /** / */
    BSlash = 64,
    /** % */
    BPercent = 65,
    /** += */
    BPlusEqual = 66,
    /** -= */
    BMinusEqual = 67,
    /** /= */
    BSlashEqual = 68,
    /** *= */
    BAsteriskEqual = 69,
    /**
     * Stack:
     *   env or object
     *   name
     */
    Delete = 70,
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
    ThrowReferenceError = 71,
    PostFixMinusMinus = 72,
    /**
     * ```txt
     * a++
     * Stack:
     *   env or object
     *   name
     * ```
     */
    PostFixPlusPLus = 73,
    PrefixUnaryPlus = 74,
    PrefixUnaryMinus = 75,
    PrefixExclamation = 76,
    PrefixTilde = 77,
    PrefixPlusPlus = 78,
    PrefixMinusMinus = 79,
    /**
     * debugger;
     */
    Debugger = 80
}
export declare const enum ResolveType {
    normal = 0,
    throw = 1,
    return = 2
}
export declare const enum FunctionTypes {
    SourceFile = 0,
    FunctionDeclaration = 1,
    FunctionExpression = 2,
    ArrowFunction = 3,
    MethodDeclaration = 4,
    GetAccessor = 5,
    SetAccessor = 6,
    Constructor = 7
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
