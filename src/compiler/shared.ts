export const TEXT_DADA_MASK = 0x80000000

export const isSmallNumber = (a: any): a is number => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)
}

/** Literal pool tail entries: `[label, length, ...payload]` (`length` = payload word count). MUST SYNC with runtime `decodeLiteralFromProgram`. */
export const enum LiteralPoolKind {
    Boolean = 1,
    Number = 2,
    String = 3,
    BigInt = 4,
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
    /**
     * Compile-time placeholder used to anchor branches and empty segments.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: Codegen emits this with length 0, so it normally produces no runtime word.
     */
    Nop,
    /**
     * Pushes a decoded literal value.
     * Stack (bottom to top): <empty>
     * Result: literalValue
     * Notes: Reads the next encoded word as either a small inline integer or a literal-pool address.
     */
    Literal,
    /**
     * Pushes `null`.
     * Stack (bottom to top): <empty>
     * Result: null
     */
    NullLiteral,
    /**
     * Pushes `undefined`.
     * Stack (bottom to top): <empty>
     * Result: undefined
     */
    UndefinedLiteral,

    /**
     * Compile-time pseudo-op that resolves a node or op target to a numeric jump/function offset.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: The encoder rewrites this into a `Literal` that pushes the resolved offset.
     */
    NodeOffset,
    /**
     * Compile-time pseudo-op that resolves a function-like node to a `FunctionTypes` value.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: The encoder rewrites this into a `Literal` that pushes the resolved function type.
     */
    NodeFunctionType,
    /**
     * Jumps when the condition is falsy.
     * Stack (bottom to top): offset, condition
     * Result: no stack result.
     */
    JumpIfNot,
    /**
     * Jumps when the condition is truthy.
     * Stack (bottom to top): offset, condition
     * Result: no stack result.
     */
    JumpIf,
    /**
     * Performs an unconditional jump.
     * Stack (bottom to top): offset
     * Result: no stack result.
     */
    Jump,
    /**
     * Jumps when the condition is truthy and preserves that condition.
     * Stack (bottom to top): offset, condition
     * Result: condition
     */
    JumpIfAndKeep,
    /**
     * Jumps when the condition is falsy and preserves that condition.
     * Stack (bottom to top): offset, condition
     * Result: condition
     */
    JumpIfNotAndKeep,

    /**
     * Initializes a function or source-file activation scope from the current call setup.
     * Stack (bottom to top): `thisValue`, `fn`, `fnName`, `InvokeType.Apply`, argument * O, argumentCount, parameterName * N (reversed), parameterNameCount, restParameterIndex, [variableName, variableType] * M, variableCount, functionType
     * Result: no stack result.
     * Notes: Under `InvokeType.Construct`, the bottom value is `newTarget` instead of `thisValue`. `restParameterIndex` is `-1` when absent. This opcode binds parameters, locals, `this`, `new.target`, and debug scope state.
     */
    EnterFunction,
    /**
     * Creates a block scope and defines its declared bindings.
     * Stack (bottom to top): [variableName, variableType] * M, variableCount
     * Result: no stack result.
     */
    EnterScope,
    /**
     * Creates a `with` object-environment scope from the provided value.
     * Stack (bottom to top): value
     * Result: no stack result.
     * Notes: Applies `ToObject`, throws on `null` / `undefined`, and enables `@@unscopables` name filtering.
     */
    EnterWith,
    /**
     * Removes the current block scope.
     * Stack (bottom to top): <empty>
     * Result: no stack result.
     */
    LeaveScope,

    /**
     * Drops the top stack value.
     * Stack (bottom to top): value
     * Result: no stack result.
     */
    Pop,
    /**
     * Stores the current top value as the eval result without consuming it.
     * Stack (bottom to top): value
     * Result: stack unchanged.
     * Notes: Peeks the top entry only.
     */
    SetEvalResult,
    /**
     * Duplicates the top stack value.
     * Stack (bottom to top): value
     * Result: value, value
     */
    Duplicate,

    /**
     * Pushes the current environment record / frame handle.
     * Stack (bottom to top): <empty>
     * Result: currentRecord
     */
    GetRecord,
    /**
     * Reads a statically resolved binding with TDZ / missing-binding checks.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: value
     */
    GetStatic,
    /**
     * Reads a statically resolved binding and preserves its slot operands.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: scopeDepth, scopeIndex, value
     * Notes: Used when later evaluation must keep the same static binding while using the pre-read value.
     */
    GetStaticKeepCtx,
    /**
     * Reads a statically resolved binding without the checked access path.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: value
     */
    GetStaticUnchecked,
    /**
     * Reads a statically resolved binding without checks and preserves its slot operands.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: scopeDepth, scopeIndex, value
     * Notes: Used when later evaluation must keep the same unchecked static binding while using the pre-read value.
     */
    GetStaticUncheckedKeepCtx,
    /**
     * Initializes an existing binding through a record lookup.
     * Stack (bottom to top): env, name, value
     * Result: value
     */
    SetInitialized,
    /**
     * Initializes an existing statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetInitializedStatic,
    /**
     * Writes a binding or property and returns the written value.
     * Stack (bottom to top): target, name, value
     * Result: value
     */
    Set,
    /**
     * Writes a checked statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetStatic,
    /**
     * Writes an unchecked statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetStaticUnchecked,
    /**
     * Writes a binding or property and preserves the target on the stack.
     * Stack (bottom to top): target, name, value
     * Result: target
     */
    SetKeepCtx,
    /**
     * Applies multiple binding writes to the same environment.
     * Stack (bottom to top): [name, value, setFlag] * M, itemCount, env
     * Result: no stack result.
     * Notes: Each `setFlag` controls TDZ clearing and optional freezing for that item.
     */
    SetMultiple,
    /**
     * Defines an own property on an object and preserves that object.
     * Stack (bottom to top): object, name, value
     * Result: object
     */
    DefineKeepCtx,
    /**
     * Reads a binding or property by name.
     * Stack (bottom to top): target, name
     * Result: value
     */
    Get,
    /**
     * Reads a binding or property by name and preserves its lookup operands.
     * Stack (bottom to top): target, name
     * Result: target, name, value
     * Notes: Used for compound assignments so the left value is read before the RHS while preserving the original reference.
     */
    GetKeepCtx,
    /**
     * Resolves an identifier reference once before later side effects.
     * Stack (bottom to top): target, name
     * Result: resolvedReference, name
     * Notes: Used for dynamic identifier writes/updates/calls where later evaluation must preserve the original binding choice.
     */
    ResolveScope,
    /**
     * Resolves an identifier reference and reads its current value before later RHS evaluation.
     * Stack (bottom to top): target, name
     * Result: resolvedReference, name, currentValue
     * Notes: Used for dynamic identifier compound assignments/calls so both binding selection and left-value read happen before later side effects.
     */
    ResolveScopeGetValue,
    /**
     * Clears the TDZ flag for a binding without consuming the lookup operands.
     * Stack (bottom to top): env, name
     * Result: stack unchanged.
     * Notes: Peeks the top two entries only.
     */
    DeTDZ,
    /**
     * Clears the TDZ flag for a statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: no stack result.
     */
    DeTDZStatic,
    /**
     * Marks a binding as immutable without consuming the lookup operands.
     * Stack (bottom to top): env, name
     * Result: stack unchanged.
     * Notes: Peeks the top two entries only.
     */
    FreezeVariable,
    /**
     * Marks a statically resolved binding slot as immutable.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: no stack result.
     */
    FreezeVariableStatic,

    /**
     * Creates a VM function object from encoded metadata.
     * Stack (bottom to top): name, nodeOffset, nodeFunctionType
     * Result: fn
     */
    DefineFunction,
    /**
     * Returns from the current function.
     * Stack (bottom to top): value
     * Result: no direct stack result in the current frame.
     * Notes: Unwinds to the nearest function frame. On the caller side, it pushes the effective return value, with constructor semantics able to substitute `this`.
     */
    Return,
    /**
     * Initiates a `return` while inside try/catch/finally control flow.
     * Stack (bottom to top): value
     * Result: no direct stack result.
     * Notes: This stages the return through pending `finally` logic when needed.
     */
    ReturnInTryCatchFinally,
    /**
     * Throws the top value immediately.
     * Stack (bottom to top): value
     * Result: no result; always throws.
     */
    Throw,
    /**
     * Initiates a `throw` while inside try/catch/finally control flow.
     * Stack (bottom to top): value
     * Result: no direct stack result.
     * Notes: This stages the throw through catch/finally logic when needed.
     */
    ThrowInTryCatchFinally,
    /**
     * Initiates a `break` that may need to cross try/finally frames.
     * Stack (bottom to top): depth, breakAddr
     * Result: no direct stack result.
     */
    BreakInTryCatchFinally,
    /**
     * Leaves the current try/catch/finally phase according to its stored resolve state.
     * Stack (bottom to top): <empty>
     * Result: no direct stack result.
     * Notes: Reads the active try frame state rather than value-stack operands.
     */
    ExitTryCatchFinally,
    /**
     * Creates a try-control frame for upcoming try/catch/finally handling.
     * Stack (bottom to top): exitAddr, catchAddr, finallyAddr, catchClauseName
     * Result: no stack result.
     */
    InitTryCatch,

    /**
     * Calls a property or binding by `(target, name)`.
     * Stack (bottom to top): target, name, argument * M, argumentCount
     * Result: returnValue
     * Notes: VM functions transfer control into a new frame instead of pushing synchronously. Async functions yield promises, and generator functions yield iterators.
     */
    Call,
    /**
     * Calls a property or binding whose callee value was pre-read earlier.
     * Stack (bottom to top): target, name, fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: Used when identifier binding resolution and callee read must happen before argument side effects.
     */
    CallResolved,
    /**
     * Calls a property or binding like `Call`, but preserves local-scope eval semantics.
     * Stack (bottom to top): target, name, argument * M, argumentCount
     * Result: returnValue
     * Notes: Only differs from `Call` when the resolved function is `eval`.
     */
    CallAsEval,
    /**
     * Calls a pre-read property or binding like `CallResolved`, but preserves local-scope eval semantics.
     * Stack (bottom to top): target, name, fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: Only differs from `CallResolved` when the resolved function is `eval`.
     */
    CallAsEvalResolved,
    /**
     * Constructs a new instance from a callable value.
     * Stack (bottom to top): fn, argument * M, argumentCount
     * Result: instanceOrConstructorReturn
     * Notes: VM constructors transfer control into a new frame instead of pushing synchronously.
     */
    New,
    /**
     * Calls a callable value already on the stack.
     * Stack (bottom to top): fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: VM functions transfer control into a new frame instead of pushing synchronously. Async functions yield promises, and generator functions yield iterators.
     */
    CallValue,
    /**
     * Expands a prepared argument array back into the VM call stack format.
     * Stack (bottom to top): argumentArray
     * Result: argument * M, argumentCount
     * Notes: Used for spread calls/new/super without lowering to `.apply(...)`.
     */
    ExpandArgumentArray,

    /**
     * Computes `typeof value`.
     * Stack (bottom to top): value
     * Result: typeofValue
     */
    Typeof,
    /**
     * Computes `typeof target[name]` / `typeof binding`.
     * Stack (bottom to top): target, name
     * Result: typeofValue
     * Notes: Missing environment bindings produce `'undefined'` instead of throwing.
     */
    TypeofReference,
    /**
     * Computes `typeof` for a checked statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: typeofValue
     */
    TypeofStaticReference,
    /**
     * Computes `typeof` for an unchecked statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: typeofValue
     */
    TypeofStaticReferenceUnchecked,

    /**
     * Evaluates `left instanceof right`.
     * Stack (bottom to top): left, right
     * Result: left instanceof right
     */
    InstanceOf,
    /**
     * Creates a property-name iterator for `for...in`.
     * Stack (bottom to top): value
     * Result: iterator
     */
    GetPropertyIterator,
    /**
     * Advances an iterator and pushes its `IteratorResult`.
     * Stack (bottom to top): iterator
     * Result: iteratorEntry
     */
    NextEntry,
    /**
     * Reads `.done` from an `IteratorResult`.
     * Stack (bottom to top): iteratorEntry
     * Result: isDone
     */
    EntryIsDone,
    /**
     * Reads `.value` from an `IteratorResult`.
     * Stack (bottom to top): iteratorEntry
     * Result: entryValue
     */
    EntryGetValue,
    /**
     * Creates a new array literal container.
     * Stack (bottom to top): <empty>
     * Result: array
     */
    ArrayLiteral,
    /**
     * Creates a new object literal container.
     * Stack (bottom to top): <empty>
     * Result: object
     */
    ObjectLiteral,
    /**
     * Creates a regular expression object.
     * Stack (bottom to top): source, flags
     * Result: regexp
     */
    RegexpLiteral,

    /**
     * Evaluates `left in right`.
     * Stack (bottom to top): left, right
     * Result: left in right
     */
    BIn,
    /**
     * Evaluates `left + right`.
     * Stack (bottom to top): left, right
     * Result: left + right
     */
    BPlus,
    /**
     * Evaluates `left - right`.
     * Stack (bottom to top): left, right
     * Result: left - right
     */
    BMinus,
    /**
     * Evaluates `left ^ right`.
     * Stack (bottom to top): left, right
     * Result: left ^ right
     */
    BCaret,
    /**
     * Evaluates `left & right`.
     * Stack (bottom to top): left, right
     * Result: left & right
     */
    BAmpersand,
    /**
     * Evaluates `left | right`.
     * Stack (bottom to top): left, right
     * Result: left | right
     */
    BBar,
    /**
     * Evaluates `left > right`.
     * Stack (bottom to top): left, right
     * Result: left > right
     */
    BGreaterThan,
    /**
     * Evaluates `left >> right`.
     * Stack (bottom to top): left, right
     * Result: left >> right
     */
    BGreaterThanGreaterThan,
    /**
     * Evaluates `left >>> right`.
     * Stack (bottom to top): left, right
     * Result: left >>> right
     */
    BGreaterThanGreaterThanGreaterThan,
    /**
     * Evaluates `left >= right`.
     * Stack (bottom to top): left, right
     * Result: left >= right
     */
    BGreaterThanEquals,
    /**
     * Evaluates `left < right`.
     * Stack (bottom to top): left, right
     * Result: left < right
     */
    BLessThan,
    /**
     * Evaluates `left << right`.
     * Stack (bottom to top): left, right
     * Result: left << right
     */
    BLessThanLessThan,
    /**
     * Evaluates `left <= right`.
     * Stack (bottom to top): left, right
     * Result: left <= right
     */
    BLessThanEquals,
    /**
     * Evaluates `left == right`.
     * Stack (bottom to top): left, right
     * Result: left == right
     */
    BEqualsEquals,
    /**
     * Evaluates `left === right`.
     * Stack (bottom to top): left, right
     * Result: left === right
     */
    BEqualsEqualsEquals,
    /**
     * Evaluates `left != right`.
     * Stack (bottom to top): left, right
     * Result: left != right
     */
    BExclamationEquals,
    /**
     * Evaluates `left !== right`.
     * Stack (bottom to top): left, right
     * Result: left !== right
     */
    BExclamationEqualsEquals,
    /**
     * Evaluates `left * right`.
     * Stack (bottom to top): left, right
     * Result: left * right
     */
    BAsterisk,
    /**
     * Evaluates `left / right`.
     * Stack (bottom to top): left, right
     * Result: left / right
     */
    BSlash,
    /**
     * Evaluates `left % right`.
     * Stack (bottom to top): left, right
     * Result: left % right
     */
    BPercent,

    /**
     * Evaluates `target[name] += value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BPlusEqual,
    /**
     * Evaluates a checked statically resolved `+=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BPlusEqualStatic,
    /**
     * Evaluates an unchecked statically resolved `+=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BPlusEqualStaticUnchecked,
    /**
     * Evaluates `target[name] -= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BMinusEqual,
    /**
     * Evaluates a checked statically resolved `-=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BMinusEqualStatic,
    /**
     * Evaluates an unchecked statically resolved `-=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BMinusEqualStaticUnchecked,
    /**
     * Evaluates `target[name] /= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BSlashEqual,
    /**
     * Evaluates a checked statically resolved `/=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BSlashEqualStatic,
    /**
     * Evaluates an unchecked statically resolved `/=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BSlashEqualStaticUnchecked,
    /**
     * Evaluates `target[name] *= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BAsteriskEqual,
    /**
     * Evaluates a checked statically resolved `*=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BAsteriskEqualStatic,
    /**
     * Evaluates an unchecked statically resolved `*=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BAsteriskEqualStaticUnchecked,
    /**
     * Evaluates `target[name] >>>= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqual,
    /**
     * Evaluates a checked statically resolved `>>>=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqualStatic,
    /**
     * Evaluates an unchecked statically resolved `>>>=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked,

    /**
     * Deletes a property or binding target.
     * Stack (bottom to top): target, name
     * Result: deleteSucceeded
     */
    Delete,
    /**
     * Throws a `ReferenceError` from the provided message.
     * Stack (bottom to top): message
     * Result: no result; always throws.
     */
    ThrowReferenceError,

    /**
     * Evaluates `target[name]--` and returns the previous value.
     * Stack (bottom to top): target, name
     * Result: oldValue
     */
    PostFixMinusMinus,
    /**
     * Evaluates a checked statically resolved `--` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixMinusMinusStatic,
    /**
     * Evaluates an unchecked statically resolved `--` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixMinusMinusStaticUnchecked,
    /**
     * Evaluates `target[name]++` and returns the previous value.
     * Stack (bottom to top): target, name
     * Result: oldValue
     */
    PostFixPlusPLus,
    /**
     * Evaluates a checked statically resolved `++` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixPlusPLusStatic,
    /**
     * Evaluates an unchecked statically resolved `++` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixPlusPLusStaticUnchecked,
    /**
     * Applies unary `+`.
     * Stack (bottom to top): value
     * Result: +value
     */
    PrefixUnaryPlus,
    /**
     * Applies unary `-`.
     * Stack (bottom to top): value
     * Result: -value
     */
    PrefixUnaryMinus,
    /**
     * Applies logical negation.
     * Stack (bottom to top): value
     * Result: !value
     */
    PrefixExclamation,
    /**
     * Applies bitwise NOT.
     * Stack (bottom to top): value
     * Result: ~value
     */
    PrefixTilde,

    /**
     * Evaluates `++target[name]`.
     * Stack (bottom to top): target, name
     * Result: newValue
     */
    PrefixPlusPlus,
    /**
     * Evaluates a checked statically resolved prefix `++`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixPlusPlusStatic,
    /**
     * Evaluates an unchecked statically resolved prefix `++`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixPlusPlusStaticUnchecked,
    /**
     * Evaluates `--target[name]`.
     * Stack (bottom to top): target, name
     * Result: newValue
     */
    PrefixMinusMinus,
    /**
     * Evaluates a checked statically resolved prefix `--`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixMinusMinusStatic,
    /**
     * Evaluates an unchecked statically resolved prefix `--`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixMinusMinusStaticUnchecked,

    /**
     * Triggers debugger instrumentation.
     * Stack (bottom to top): <empty>
     * Result: no stack result.
     * Notes: Invokes the registered debug callback or falls back to the host `debugger` statement.
     */
    Debugger,

    /**
     * Creates a class constructor function and wires its prototype chain.
     * Stack (bottom to top): ctorFn, superClass, className
     * Result: classFn
     * Notes: `ctorFn` may be `undefined`, in which case a default constructor is synthesized.
     */
    CreateClass,
    /**
     * Defines a non-enumerable method and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     */
    DefineMethod,
    /**
     * Defines a non-enumerable getter and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     * Notes: Preserves any existing setter on that property.
     */
    DefineGetter,
    /**
     * Defines a non-enumerable setter and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     * Notes: Preserves any existing getter on that property.
     */
    DefineSetter,

    /**
     * Suspends a generator and yields the provided value.
     * Stack (bottom to top): value
     * Result: no immediate stack result.
     * Notes: On suspension it returns `{ value, done: false }` to the caller or host.
     */
    Yield,
    /**
     * Finalizes resumption of a suspended `yield` expression.
     * Stack (bottom to top): resumeValue
     * Result: resumeValue
     * Notes: If the caller resumed with `.throw()` or `.return()`, this consumes the resume value and transfers control instead.
     */
    YieldResume,
    /**
     * Starts or resumes `yield*` delegation.
     * Stack (bottom to top): iterable on first entry; resumeValue or delegatedResult on later entries
     * Result: delegateReturnValue when delegation completes
     * Notes: May suspend repeatedly, forward `.throw()` / `.return()`, or re-enter with a delegated iterator result.
     */
    YieldStar,
    /**
     * Suspends async execution until the awaited value settles.
     * Stack (bottom to top): value
     * Result: no immediate stack result.
     * Notes: The async runner later pushes the resolved value back onto the stack or resumes with a pending throw on rejection.
     */
    Await,

    /**
     * Calls `super(...)` during derived-constructor initialization.
     * Stack (bottom to top): newTarget, fn, argument * M, argumentCount
     * Result: constructedThis
     * Notes: The caller may keep additional setup values below these operands; they are preserved.
     */
    SuperCall,
    /**
     * Appends all values from an iterable into an existing array.
     * Stack (bottom to top): array, iterable
     * Result: array
     */
    ArraySpread,
    /**
     * Creates and caches a frozen tagged-template object for the current site.
     * Stack (bottom to top): rawPart * N, cookedPart * N, partCount
     * Result: templateObject
     * Notes: Reuses the same object for the same program site and realm, and defines a frozen non-enumerable `raw` array.
     */
    TemplateObject,
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
