export declare const TEXT_DADA_MASK = 2147483648;
/** Runtime binding-name sentinel for static temp slots that are never resolved by name. */
export declare const STATIC_SLOT_NAMELESS = "";
export declare const isSmallNumber: (a: any) => a is number;
/** Literal pool tail entries: `[label, length, ...payload]` (`length` = payload word count). MUST SYNC with runtime `decodeLiteralFromProgram`. */
export declare const enum LiteralPoolKind {
    Boolean = 1,
    Number = 2,
    String = 3,
    BigInt = 4
}
/** XOR mask for each pool word at absolute program index `i` (position-dependent). MUST SYNC with runtime `literalPoolWordMask`. */
export declare const literalPoolWordMask: (i: number) => number;
export declare const enum SpecialVariable {
    This = "[this]",
    SwitchValue = "[switch]",
    LoopIterator = "[iter]",
    IteratorEntry = "[entry]",
    SyntheticScope = "[syntheticScope]",
    Super = "[super]",
    NewTarget = "[newTarget]"
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
    Construct = 1,
    Generator = 2
}
export type ProgramScopeDebugMap = Map<number, readonly string[]>;
export declare const enum OpCode {
    /**
     * Compile-time placeholder used to anchor branches and empty segments.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: Codegen emits this with length 0, so it normally produces no runtime word.
     */
    Nop = 0,
    /**
     * Pushes a decoded literal value.
     * Stack (bottom to top): <empty>
     * Result: literalValue
     * Notes: Reads the next encoded word as either a small inline integer or a literal-pool address.
     */
    Literal = 1,
    /**
     * Pushes `null`.
     * Stack (bottom to top): <empty>
     * Result: null
     */
    NullLiteral = 2,
    /**
     * Pushes `undefined`.
     * Stack (bottom to top): <empty>
     * Result: undefined
     */
    UndefinedLiteral = 3,
    /**
     * Compile-time pseudo-op that resolves a node or op target to a numeric jump/function offset.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: The encoder rewrites this into a `Literal` that pushes the resolved offset.
     */
    NodeOffset = 4,
    /**
     * Compile-time pseudo-op that resolves a function-like node to a `FunctionTypes` value.
     * Stack (bottom to top): <empty>
     * Result: not executed directly.
     * Notes: The encoder rewrites this into a `Literal` that pushes the resolved function type.
     */
    NodeFunctionType = 5,
    /**
     * Jumps when the condition is falsy.
     * Stack (bottom to top): offset, condition
     * Result: no stack result.
     */
    JumpIfNot = 6,
    /**
     * Jumps when the condition is truthy.
     * Stack (bottom to top): offset, condition
     * Result: no stack result.
     */
    JumpIf = 7,
    /**
     * Performs an unconditional jump.
     * Stack (bottom to top): offset
     * Result: no stack result.
     */
    Jump = 8,
    /**
     * Jumps when the condition is truthy and preserves that condition.
     * Stack (bottom to top): offset, condition
     * Result: condition
     */
    JumpIfAndKeep = 9,
    /**
     * Jumps when the condition is falsy and preserves that condition.
     * Stack (bottom to top): offset, condition
     * Result: condition
     */
    JumpIfNotAndKeep = 10,
    /**
     * Initializes a function or source-file activation scope from the current call setup.
     * Stack (bottom to top): `thisValue`, `fn`, `fnName`, `InvokeType.Apply`, argument * O, argumentCount, parameterName * N (reversed), parameterNameCount, simpleParameterList, hasParameterExpressions, restParameterIndex, [variableName, variableType] * M, variableCount, functionType
     * Result: no stack result.
     * Notes: Under `InvokeType.Construct`, the bottom value is `newTarget` instead of `thisValue`. `restParameterIndex` is `-1` when absent. This opcode binds parameters, locals, `this`, `new.target`, and debug scope state.
     */
    EnterFunction = 11,
    /**
     * Creates a block scope and defines its declared bindings.
     * Stack (bottom to top): [variableName, variableType] * M, variableCount
     * Result: no stack result.
     */
    EnterScope = 12,
    /**
     * Creates the function body scope after parameter initialization and makes it the active variable environment.
     * Stack (bottom to top): [variableName, variableType] * M, variableCount
     * Result: no stack result.
     */
    EnterBodyScope = 13,
    /**
     * Creates a `with` object-environment scope from the provided value.
     * Stack (bottom to top): value
     * Result: no stack result.
     * Notes: Applies `ToObject`, throws on `null` / `undefined`, and enables `@@unscopables` name filtering.
     */
    EnterWith = 14,
    /**
     * Removes the current block scope.
     * Stack (bottom to top): <empty>
     * Result: no stack result.
     */
    LeaveScope = 15,
    /**
     * Drops the top stack value.
     * Stack (bottom to top): value
     * Result: no stack result.
     */
    Pop = 16,
    /**
     * Stores the current top value as the eval result without consuming it.
     * Stack (bottom to top): value
     * Result: stack unchanged.
     * Notes: Peeks the top entry only.
     */
    SetEvalResult = 17,
    /**
     * Duplicates the top stack value.
     * Stack (bottom to top): value
     * Result: value, value
     */
    Duplicate = 18,
    /**
     * Duplicates the value below the top stack value.
     * Stack (bottom to top): value, top
     * Result: value, top, value
     */
    DuplicateSecond = 19,
    /**
     * Swaps the top two stack values.
     * Stack (bottom to top): belowTop, top
     * Result: top, belowTop
     */
    Swap = 20,
    /**
     * Pushes the current environment record / frame handle.
     * Stack (bottom to top): <empty>
     * Result: currentRecord
     */
    GetRecord = 21,
    /**
     * Reads a statically resolved binding with TDZ / missing-binding checks.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: value
     */
    GetStatic = 22,
    /**
     * Reads a statically resolved binding and preserves its slot operands.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: scopeDepth, scopeIndex, value
     * Notes: Used when later evaluation must keep the same static binding while using the pre-read value.
     */
    GetStaticKeepCtx = 23,
    /**
     * Reads a statically resolved binding without the checked access path.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: value
     */
    GetStaticUnchecked = 24,
    /**
     * Reads a statically resolved binding without checks and preserves its slot operands.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: scopeDepth, scopeIndex, value
     * Notes: Used when later evaluation must keep the same unchecked static binding while using the pre-read value.
     */
    GetStaticUncheckedKeepCtx = 25,
    /**
     * Initializes an existing binding through a record lookup.
     * Stack (bottom to top): env, name, value
     * Result: value
     */
    SetInitialized = 26,
    /**
     * Initializes an existing statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetInitializedStatic = 27,
    /**
     * Writes a binding or property and returns the written value.
     * Stack (bottom to top): target, name, value
     * Result: value
     */
    Set = 28,
    /**
     * Writes a checked statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetStatic = 29,
    /**
     * Writes an unchecked statically resolved binding slot.
     * Stack (bottom to top): value, scopeDepth, scopeIndex
     * Result: value
     */
    SetStaticUnchecked = 30,
    /**
     * Writes a binding or property and preserves the target on the stack.
     * Stack (bottom to top): target, name, value
     * Result: target
     */
    SetKeepCtx = 31,
    /**
     * Applies multiple binding writes to the same environment.
     * Stack (bottom to top): [name, value, setFlag] * M, itemCount, env
     * Result: no stack result.
     * Notes: Each `setFlag` controls TDZ clearing and optional freezing for that item.
     */
    SetMultiple = 32,
    /**
     * Defines an own property on an object and preserves that object.
     * Stack (bottom to top): object, name, value
     * Result: object
     */
    DefineKeepCtx = 33,
    /**
     * Applies object-literal `__proto__:` prototype mutation and preserves that object.
     * Stack (bottom to top): object, value
     * Result: object
     */
    SetPrototypeKeepCtx = 34,
    /**
     * Reads a binding or property by name.
     * Stack (bottom to top): target, name
     * Result: value
     */
    Get = 35,
    /**
     * Reads a binding or property by name and preserves its lookup operands.
     * Stack (bottom to top): target, name
     * Result: target, name, value
     * Notes: Used for compound assignments so the left value is read before the RHS while preserving the original reference.
     */
    GetKeepCtx = 36,
    /**
     * Resolves an identifier reference once before later side effects.
     * Stack (bottom to top): target, name
     * Result: resolvedReference, name
     * Notes: Used for dynamic identifier writes/updates/calls where later evaluation must preserve the original binding choice.
     */
    ResolveScope = 37,
    /**
     * Resolves an identifier reference and reads its current value before later RHS evaluation.
     * Stack (bottom to top): target, name
     * Result: resolvedReference, name, currentValue
     * Notes: Used for dynamic identifier compound assignments/calls so both binding selection and left-value read happen before later side effects.
     */
    ResolveScopeGetValue = 38,
    /**
     * Clears the TDZ flag for a binding without consuming the lookup operands.
     * Stack (bottom to top): env, name
     * Result: stack unchanged.
     * Notes: Peeks the top two entries only.
     */
    DeTDZ = 39,
    /**
     * Clears the TDZ flag for a statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: no stack result.
     */
    DeTDZStatic = 40,
    /**
     * Marks a binding as immutable without consuming the lookup operands.
     * Stack (bottom to top): env, name
     * Result: stack unchanged.
     * Notes: Peeks the top two entries only.
     */
    FreezeVariable = 41,
    /**
     * Marks a statically resolved binding slot as immutable.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: no stack result.
     */
    FreezeVariableStatic = 42,
    /**
     * Creates a VM function object from encoded metadata.
     * Stack (bottom to top): name, expectedArgumentCount, nodeOffset, bodyOffset, nodeFunctionType
     * Result: fn
     */
    DefineFunction = 43,
    /**
     * Returns from the current function.
     * Stack (bottom to top): value
     * Result: no direct stack result in the current frame.
     * Notes: Unwinds to the nearest function frame. On the caller side, it pushes the effective return value, with constructor semantics able to substitute `this`.
     */
    Return = 44,
    /**
     * Initiates a `return` while inside try/catch/finally control flow.
     * Stack (bottom to top): value
     * Result: no direct stack result.
     * Notes: This stages the return through pending `finally` logic when needed.
     */
    ReturnInTryCatchFinally = 45,
    /**
     * Throws the top value immediately.
     * Stack (bottom to top): value
     * Result: no result; always throws.
     */
    Throw = 46,
    /**
     * Initiates a `throw` while inside try/catch/finally control flow.
     * Stack (bottom to top): value
     * Result: no direct stack result.
     * Notes: This stages the throw through catch/finally logic when needed.
     */
    ThrowInTryCatchFinally = 47,
    /**
     * Initiates a `break` that may need to cross try/finally frames.
     * Stack (bottom to top): depth, breakAddr
     * Result: no direct stack result.
     */
    BreakInTryCatchFinally = 48,
    /**
     * Leaves the current try/catch/finally phase according to its stored resolve state.
     * Stack (bottom to top): <empty>
     * Result: no direct stack result.
     * Notes: Reads the active try frame state rather than value-stack operands.
     */
    ExitTryCatchFinally = 49,
    /**
     * Creates a try-control frame for upcoming try/catch/finally handling.
     * Stack (bottom to top): exitAddr, catchAddr, finallyAddr, catchClauseName
     * Result: no stack result.
     */
    InitTryCatch = 50,
    /**
     * Calls a property or binding by `(target, name)`.
     * Stack (bottom to top): target, name, argument * M, argumentCount
     * Result: returnValue
     * Notes: VM functions transfer control into a new frame instead of pushing synchronously. Async functions yield promises, and generator functions yield iterators.
     */
    Call = 51,
    /**
     * Calls a property or binding whose callee value was pre-read earlier.
     * Stack (bottom to top): target, name, fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: Used when identifier binding resolution and callee read must happen before argument side effects.
     */
    CallResolved = 52,
    /**
     * Calls a property or binding like `Call`, but preserves local-scope eval semantics.
     * Stack (bottom to top): target, name, argument * M, argumentCount
     * Result: returnValue
     * Notes: Only differs from `Call` when the resolved function is `eval`.
     */
    CallAsEval = 53,
    /**
     * Calls a pre-read property or binding like `CallResolved`, but preserves local-scope eval semantics.
     * Stack (bottom to top): target, name, fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: Only differs from `CallResolved` when the resolved function is `eval`.
     */
    CallAsEvalResolved = 54,
    /**
     * Constructs a new instance from a callable value.
     * Stack (bottom to top): fn, argument * M, argumentCount
     * Result: instanceOrConstructorReturn
     * Notes: VM constructors transfer control into a new frame instead of pushing synchronously.
     */
    New = 55,
    /**
     * Calls a callable value already on the stack.
     * Stack (bottom to top): fn, argument * M, argumentCount
     * Result: returnValue
     * Notes: VM functions transfer control into a new frame instead of pushing synchronously. Async functions yield promises, and generator functions yield iterators.
     */
    CallValue = 56,
    /**
     * Expands a prepared argument array back into the VM call stack format.
     * Stack (bottom to top): argumentArray
     * Result: argument * M, argumentCount
     * Notes: Used for spread calls/new/super without lowering to `.apply(...)`.
     */
    ExpandArgumentArray = 57,
    /**
     * Computes `typeof value`.
     * Stack (bottom to top): value
     * Result: typeofValue
     */
    Typeof = 58,
    /**
     * Applies ECMAScript `ToPropertyKey`.
     * Stack (bottom to top): value
     * Result: propertyKey
     */
    ToPropertyKey = 59,
    /**
     * Computes `typeof target[name]` / `typeof binding`.
     * Stack (bottom to top): target, name
     * Result: typeofValue
     * Notes: Missing environment bindings produce `'undefined'` instead of throwing.
     */
    TypeofReference = 60,
    /**
     * Computes `typeof` for a checked statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: typeofValue
     */
    TypeofStaticReference = 61,
    /**
     * Computes `typeof` for an unchecked statically resolved binding slot.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: typeofValue
     */
    TypeofStaticReferenceUnchecked = 62,
    /**
     * Evaluates `left instanceof right`.
     * Stack (bottom to top): left, right
     * Result: left instanceof right
     */
    InstanceOf = 63,
    /**
     * Creates a property-name iterator for `for...in`.
     * Stack (bottom to top): value
     * Result: iterator
     */
    GetPropertyIterator = 64,
    /**
     * Creates an ECMAScript iterator record for `for...of`.
     * Stack (bottom to top): iterable
     * Result: iteratorRecord
     * Notes: Captures the iterator's `next` method during loop prologue.
     */
    GetIterator = 65,
    /**
     * Advances an ECMAScript iterator record.
     * Stack (bottom to top): iteratorRecord
     * Result: iteratorEntry
     */
    IteratorNext = 66,
    /**
     * Performs ECMAScript `IteratorClose` for a `for...of` iterator record.
     * Stack (bottom to top): iteratorRecord, suppressErrors
     * Result: no stack result.
     * Notes: `suppressErrors` is true for throw completions, where close errors do not replace the original throw.
     */
    IteratorClose = 67,
    /**
     * Advances an iterator and pushes its `IteratorResult`.
     * Stack (bottom to top): iterator
     * Result: iteratorEntry
     */
    NextEntry = 68,
    /**
     * Reads `.done` from an `IteratorResult`.
     * Stack (bottom to top): iteratorEntry
     * Result: isDone
     */
    EntryIsDone = 69,
    /**
     * Reads `.value` from an `IteratorResult`.
     * Stack (bottom to top): iteratorEntry
     * Result: entryValue
     */
    EntryGetValue = 70,
    /**
     * Creates a new array literal container.
     * Stack (bottom to top): <empty>
     * Result: array
     */
    ArrayLiteral = 71,
    /**
     * Creates a new object literal container.
     * Stack (bottom to top): <empty>
     * Result: object
     */
    ObjectLiteral = 72,
    /**
     * Copies own enumerable properties except the excluded keys into a fresh object.
     * Stack (bottom to top): source, excludedKey * N, excludedKeyCount
     * Result: restObject
     * Notes: Uses `ToPropertyKey`-style exclusion matching for string/number/symbol keys and preserves the current realm's `Object.prototype`.
     */
    ObjectRest = 73,
    /**
     * Creates a regular expression object.
     * Stack (bottom to top): source, flags
     * Result: regexp
     */
    RegexpLiteral = 74,
    /**
     * Evaluates `left in right`.
     * Stack (bottom to top): left, right
     * Result: left in right
     */
    BIn = 75,
    /**
     * Evaluates `left + right`.
     * Stack (bottom to top): left, right
     * Result: left + right
     */
    BPlus = 76,
    /**
     * Evaluates `left - right`.
     * Stack (bottom to top): left, right
     * Result: left - right
     */
    BMinus = 77,
    /**
     * Evaluates `left ^ right`.
     * Stack (bottom to top): left, right
     * Result: left ^ right
     */
    BCaret = 78,
    /**
     * Evaluates `left & right`.
     * Stack (bottom to top): left, right
     * Result: left & right
     */
    BAmpersand = 79,
    /**
     * Evaluates `left | right`.
     * Stack (bottom to top): left, right
     * Result: left | right
     */
    BBar = 80,
    /**
     * Evaluates `left > right`.
     * Stack (bottom to top): left, right
     * Result: left > right
     */
    BGreaterThan = 81,
    /**
     * Evaluates `left >> right`.
     * Stack (bottom to top): left, right
     * Result: left >> right
     */
    BGreaterThanGreaterThan = 82,
    /**
     * Evaluates `left >>> right`.
     * Stack (bottom to top): left, right
     * Result: left >>> right
     */
    BGreaterThanGreaterThanGreaterThan = 83,
    /**
     * Evaluates `left >= right`.
     * Stack (bottom to top): left, right
     * Result: left >= right
     */
    BGreaterThanEquals = 84,
    /**
     * Evaluates `left < right`.
     * Stack (bottom to top): left, right
     * Result: left < right
     */
    BLessThan = 85,
    /**
     * Evaluates `left << right`.
     * Stack (bottom to top): left, right
     * Result: left << right
     */
    BLessThanLessThan = 86,
    /**
     * Evaluates `left <= right`.
     * Stack (bottom to top): left, right
     * Result: left <= right
     */
    BLessThanEquals = 87,
    /**
     * Evaluates `left == right`.
     * Stack (bottom to top): left, right
     * Result: left == right
     */
    BEqualsEquals = 88,
    /**
     * Evaluates `left === right`.
     * Stack (bottom to top): left, right
     * Result: left === right
     */
    BEqualsEqualsEquals = 89,
    /**
     * Evaluates `left != right`.
     * Stack (bottom to top): left, right
     * Result: left != right
     */
    BExclamationEquals = 90,
    /**
     * Evaluates `left !== right`.
     * Stack (bottom to top): left, right
     * Result: left !== right
     */
    BExclamationEqualsEquals = 91,
    /**
     * Evaluates `left * right`.
     * Stack (bottom to top): left, right
     * Result: left * right
     */
    BAsterisk = 92,
    /**
     * Evaluates `left / right`.
     * Stack (bottom to top): left, right
     * Result: left / right
     */
    BSlash = 93,
    /**
     * Evaluates `left % right`.
     * Stack (bottom to top): left, right
     * Result: left % right
     */
    BPercent = 94,
    /**
     * Evaluates `left ** right`.
     * Stack (bottom to top): left, right
     * Result: left ** right
     */
    BAsteriskAsterisk = 95,
    /**
     * Evaluates `target[name] += value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BPlusEqual = 96,
    /**
     * Evaluates a checked statically resolved `+=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BPlusEqualStatic = 97,
    /**
     * Evaluates an unchecked statically resolved `+=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BPlusEqualStaticUnchecked = 98,
    /**
     * Evaluates `target[name] -= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BMinusEqual = 99,
    /**
     * Evaluates a checked statically resolved `-=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BMinusEqualStatic = 100,
    /**
     * Evaluates an unchecked statically resolved `-=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BMinusEqualStaticUnchecked = 101,
    /**
     * Evaluates `target[name] /= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BSlashEqual = 102,
    /**
     * Evaluates a checked statically resolved `/=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BSlashEqualStatic = 103,
    /**
     * Evaluates an unchecked statically resolved `/=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BSlashEqualStaticUnchecked = 104,
    /**
     * Evaluates `target[name] *= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BAsteriskEqual = 105,
    /**
     * Evaluates a checked statically resolved `*=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BAsteriskEqualStatic = 106,
    /**
     * Evaluates an unchecked statically resolved `*=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BAsteriskEqualStaticUnchecked = 107,
    /**
     * Evaluates `target[name] >>>= value`.
     * Stack (bottom to top): target, name, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqual = 108,
    /**
     * Evaluates a checked statically resolved `>>>=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqualStatic = 109,
    /**
     * Evaluates an unchecked statically resolved `>>>=`.
     * Stack (bottom to top): scopeDepth, scopeIndex, leftValue, value
     * Result: newValue
     */
    BGreaterThanGreaterThanGreaterThanEqualStaticUnchecked = 110,
    /**
     * Deletes a property or binding target.
     * Stack (bottom to top): target, name
     * Result: deleteSucceeded
     */
    Delete = 111,
    /**
     * Throws a `ReferenceError` from the provided message.
     * Stack (bottom to top): message
     * Result: no result; always throws.
     */
    ThrowReferenceError = 112,
    /**
     * Evaluates `target[name]--` and returns the previous value.
     * Stack (bottom to top): target, name
     * Result: oldValue
     */
    PostFixMinusMinus = 113,
    /**
     * Evaluates a checked statically resolved `--` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixMinusMinusStatic = 114,
    /**
     * Evaluates an unchecked statically resolved `--` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixMinusMinusStaticUnchecked = 115,
    /**
     * Evaluates `target[name]++` and returns the previous value.
     * Stack (bottom to top): target, name
     * Result: oldValue
     */
    PostFixPlusPLus = 116,
    /**
     * Evaluates a checked statically resolved `++` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixPlusPLusStatic = 117,
    /**
     * Evaluates an unchecked statically resolved `++` and returns the previous value.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: oldValue
     */
    PostFixPlusPLusStaticUnchecked = 118,
    /**
     * Applies unary `+`.
     * Stack (bottom to top): value
     * Result: +value
     */
    PrefixUnaryPlus = 119,
    /**
     * Applies unary `-`.
     * Stack (bottom to top): value
     * Result: -value
     */
    PrefixUnaryMinus = 120,
    /**
     * Applies logical negation.
     * Stack (bottom to top): value
     * Result: !value
     */
    PrefixExclamation = 121,
    /**
     * Applies bitwise NOT.
     * Stack (bottom to top): value
     * Result: ~value
     */
    PrefixTilde = 122,
    /**
     * Evaluates `++target[name]`.
     * Stack (bottom to top): target, name
     * Result: newValue
     */
    PrefixPlusPlus = 123,
    /**
     * Evaluates a checked statically resolved prefix `++`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixPlusPlusStatic = 124,
    /**
     * Evaluates an unchecked statically resolved prefix `++`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixPlusPlusStaticUnchecked = 125,
    /**
     * Evaluates `--target[name]`.
     * Stack (bottom to top): target, name
     * Result: newValue
     */
    PrefixMinusMinus = 126,
    /**
     * Evaluates a checked statically resolved prefix `--`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixMinusMinusStatic = 127,
    /**
     * Evaluates an unchecked statically resolved prefix `--`.
     * Stack (bottom to top): scopeDepth, scopeIndex
     * Result: newValue
     */
    PrefixMinusMinusStaticUnchecked = 128,
    /**
     * Triggers debugger instrumentation.
     * Stack (bottom to top): <empty>
     * Result: no stack result.
     * Notes: Invokes the registered debug callback or falls back to the host `debugger` statement.
     */
    Debugger = 129,
    /**
     * Creates a class constructor function and wires its prototype chain.
     * Stack (bottom to top): ctorFn, superClass, className
     * Result: classFn
     * Notes: `ctorFn` may be `undefined`, in which case a default constructor is synthesized.
     */
    CreateClass = 130,
    /**
     * Defines a non-enumerable method and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     */
    DefineMethod = 131,
    /**
     * Defines a non-enumerable getter and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     * Notes: Preserves any existing setter on that property.
     */
    DefineGetter = 132,
    /**
     * Defines a non-enumerable setter and preserves the target object.
     * Stack (bottom to top): object, name, fn
     * Result: object
     * Notes: Preserves any existing getter on that property.
     */
    DefineSetter = 133,
    /**
     * Suspends a generator and yields the provided value.
     * Stack (bottom to top): value
     * Result: no immediate stack result.
     * Notes: On suspension it returns `{ value, done: false }` to the caller or host.
     */
    Yield = 134,
    /**
     * Finalizes resumption of a suspended `yield` expression.
     * Stack (bottom to top): resumeValue
     * Result: resumeValue
     * Notes: If the caller resumed with `.throw()` or `.return()`, this consumes the resume value and transfers control instead.
     */
    YieldResume = 135,
    /**
     * Starts or resumes `yield*` delegation.
     * Stack (bottom to top): iterable on first entry; resumeValue or delegatedResult on later entries
     * Result: delegateReturnValue when delegation completes
     * Notes: May suspend repeatedly, forward `.throw()` / `.return()`, or re-enter with a delegated iterator result.
     */
    YieldStar = 136,
    /**
     * Suspends async execution until the awaited value settles.
     * Stack (bottom to top): value
     * Result: no immediate stack result.
     * Notes: The async runner later pushes the resolved value back onto the stack or resumes with a pending throw on rejection.
     */
    Await = 137,
    /**
     * Calls `super(...)` during derived-constructor initialization.
     * Stack (bottom to top): newTarget, fn, argument * M, argumentCount
     * Result: constructedThis
     * Notes: The caller may keep additional setup values below these operands; they are preserved.
     */
    SuperCall = 138,
    /**
     * Appends all values from an iterable into an existing array.
     * Stack (bottom to top): array, iterable
     * Result: array
     */
    ArraySpread = 139,
    /**
     * Creates and caches a frozen tagged-template object for the current site.
     * Stack (bottom to top): rawPart * N, cookedPart * N, partCount
     * Result: templateObject
     * Notes: Reuses the same object for the same program site and realm, and defines a frozen non-enumerable `raw` array.
     */
    TemplateObject = 140
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
    Constructor = 8,
    GeneratorDeclaration = 9,
    GeneratorExpression = 10,
    GeneratorMethod = 11,
    AsyncGeneratorDeclaration = 12,
    AsyncGeneratorExpression = 13,
    AsyncGeneratorMethod = 14,
    AsyncFunctionDeclaration = 15,
    AsyncFunctionExpression = 16,
    AsyncArrowFunction = 17,
    AsyncMethod = 18,
    DerivedConstructor = 19
}
