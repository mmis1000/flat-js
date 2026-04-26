/**
 * Debug helper: compile + run with per-ptr instruction tracing and cipher-sync checking.
 */
import * as compiler from '../compiler'
import { getExecution, Fields } from '../runtime'
import { InvokeType } from '../compiler'

// Correct opcode names from the actual enum (0-indexed, Reseed=93, aliases=94-102)
const OPCODE_NAMES: Record<number, string> = {
    0:'Nop', 1:'Literal', 2:'NullLiteral', 3:'UndefinedLiteral',
    4:'NodeOffset', 5:'NodeFunctionType',
    6:'JumpIfNot', 7:'JumpIf', 8:'Jump', 9:'JumpIfAndKeep', 10:'JumpIfNotAndKeep',
    11:'EnterFunction', 12:'EnterScope', 13:'LeaveScope',
    14:'Pop', 15:'SetEvalResult', 16:'Duplicate',
    17:'GetRecord', 18:'SetInitialized', 19:'Set', 20:'SetKeepCtx', 21:'SetMultiple',
    22:'DefineKeepCtx', 23:'Get', 24:'DeTDZ', 25:'FreezeVariable', 26:'DefineFunction',
    27:'Return', 28:'ReturnInTry', 29:'Throw', 30:'ThrowInTry', 31:'BreakInTry',
    32:'ExitTryCatchFinally', 33:'InitTryCatch',
    34:'Call', 35:'CallAsEval', 36:'New', 37:'CallValue',
    38:'Typeof', 39:'TypeofRef', 40:'InstanceOf',
    41:'GetPropertyIterator', 42:'NextEntry', 43:'EntryIsDone', 44:'EntryGetValue',
    45:'ArrayLiteral', 46:'ObjectLiteral', 47:'RegexpLiteral',
    48:'BIn', 49:'BPlus', 50:'BMinus', 51:'BCaret', 52:'BAmpersand', 53:'BBar',
    54:'BGreaterThan', 55:'BgtGt', 56:'BgtGtGt', 57:'BgtEq',
    58:'BLessThan', 59:'BltLt', 60:'BltEq',
    61:'BEqEq', 62:'BEqEqEq', 63:'BNeq', 64:'BNeqEq',
    65:'BAsterisk', 66:'BSlash', 67:'BPercent',
    68:'BPlusEq', 69:'BMinusEq', 70:'BSlashEq', 71:'BAsteriskEq',
    72:'Delete', 73:'ThrowReferenceError',
    74:'PostfixMM', 75:'PostfixPP', 76:'PrefixPlus', 77:'PrefixMinus',
    78:'PrefixNot', 79:'PrefixTilde', 80:'PrefixPP', 81:'PrefixMM',
    82:'Debugger', 83:'CreateClass', 84:'DefineMethod', 85:'DefineGetter', 86:'DefineSetter',
    87:'Yield', 88:'YieldResume', 89:'YieldStar', 90:'Await',
    91:'SuperCall', 92:'ArraySpread',
    93:'Reseed',
    94:'LiteralAlias1', 95:'LiteralAlias2',
    96:'GetAlias1', 97:'SetAlias1', 98:'PopAlias1', 99:'JumpAlias1',
    100:'JumpIfNotAlias1', 101:'GetRecordAlias1', 102:'DuplicateAlias1',
}

function opName(code: number): string {
    return OPCODE_NAMES[code] ?? `#${code}`
}

export interface DebugRunOptions {
    shuffleSeed?: number
    maxPerPtr?: number
    trace?: boolean
    evalMode?: boolean
}

export function debugRun(src: string, opts: DebugRunOptions = {}): unknown {
    const { shuffleSeed = 42, maxPerPtr = 5000, trace = false, evalMode = true } = opts

    const [program, info] = compiler.compile(src, { evalMode, shuffleSeed })
    const { activeSeedAtPos } = info

    const ptrCounts = new Map<number, number>()

    const onInstruction = (ptr: number, opcode: number, blockSeed: number): void => {
        const count = (ptrCounts.get(ptr) ?? 0) + 1
        ptrCounts.set(ptr, count)

        const expectedSeed = activeSeedAtPos.get(ptr)
        const seedMismatch = expectedSeed !== undefined && blockSeed !== expectedSeed

        if (trace || seedMismatch) {
            const mismatch = seedMismatch
                ? ` *** SEED MISMATCH: runtime=0x${blockSeed.toString(16)} expected=0x${expectedSeed!.toString(16)}`
                : ''
            process.stderr.write(
                `  [${String(ptr).padStart(4)}] ${opName(opcode).padEnd(20)} seed=0x${blockSeed.toString(16).padStart(8,'0')}${mismatch}\n`
            )
        }

        if (count > maxPerPtr) {
            throw new Error(`debug-run: ptr ${ptr} (${opName(opcode)}) executed ${count} times`)
        }
    }

    const execution = getExecution(
        program, 0, globalThis,
        [{}],
        { [Fields.type]: InvokeType.Apply, [Fields.function]: undefined, [Fields.name]: '', [Fields.self]: undefined },
        [],
        () => null,
        compiler.compile,
        new WeakMap(),
        onInstruction
    )

    let res
    do {
        res = execution[Fields.step]()
    } while (!res[Fields.done])

    return (res as any)[Fields.evalResult]
}
