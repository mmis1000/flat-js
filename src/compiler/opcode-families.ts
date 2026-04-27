import { OpCode, TEXT_DADA_MASK } from './shared'

export type OpcodeSafetyClass = 'hot' | 'warm' | 'cold' | 'privileged'
type RuntimeProjectionCandidate = {
    opcode: OpCode
    weight: number
    minStackDepth: number
}

const OPCODE_ALIAS_FAMILIES: Partial<Record<OpCode, readonly OpCode[]>> = {
    [OpCode.Literal]: [OpCode.Literal, OpCode.LiteralAlias1, OpCode.LiteralAlias2],
    [OpCode.ProtectedLiteral]: [OpCode.ProtectedLiteral, OpCode.ProtectedLiteralAlias1, OpCode.ProtectedLiteralAlias2],
    [OpCode.Get]: [OpCode.Get, OpCode.GetAlias1],
    [OpCode.Set]: [OpCode.Set, OpCode.SetAlias1],
    [OpCode.Pop]: [OpCode.Pop, OpCode.PopAlias1],
    [OpCode.Jump]: [OpCode.Jump, OpCode.JumpAlias1],
    [OpCode.JumpIfNot]: [OpCode.JumpIfNot, OpCode.JumpIfNotAlias1],
    [OpCode.GetRecord]: [OpCode.GetRecord, OpCode.GetRecordAlias1],
    [OpCode.Duplicate]: [OpCode.Duplicate, OpCode.DuplicateAlias1],
}

const canonicalOpcodeFamilyByMember: OpCode[] = Array.from(
    { length: OpCode._COUNT },
    (_unused, index) => index as OpCode
)

const opcodeFamilyMembers: OpCode[][] = Array.from(
    { length: OpCode._COUNT },
    (_unused, index) => [index as OpCode]
)

for (const [familyKey, members] of Object.entries(OPCODE_ALIAS_FAMILIES)) {
    const family = Number(familyKey) as OpCode
    opcodeFamilyMembers[family] = [...members]
    for (const member of members) {
        canonicalOpcodeFamilyByMember[member] = family
    }
}

export const PRIVILEGED_OPCODE_FAMILIES: readonly OpCode[] = [
    OpCode.Reseed,
    OpCode.EnterFunction,
    OpCode.DefineFunction,
    OpCode.ReturnInTryCatchFinally,
    OpCode.ThrowInTryCatchFinally,
    OpCode.BreakInTryCatchFinally,
    OpCode.ExitTryCatchFinally,
    OpCode.InitTryCatch,
]

export const HOT_OPCODE_FAMILIES: readonly OpCode[] = [
    OpCode.Literal,
    OpCode.ProtectedLiteral,
    OpCode.GetStaticUnchecked,
    OpCode.Pop,
    OpCode.Get,
    OpCode.Call,
    OpCode.Jump,
    OpCode.JumpIfNot,
    OpCode.Return,
    OpCode.GetRecord,
    OpCode.SetStaticUnchecked,
    OpCode.UndefinedLiteral,
    OpCode.Set,
]

export const WARM_OPCODE_FAMILIES: readonly OpCode[] = [
    OpCode.SetInitializedStatic,
    OpCode.DefineKeepCtx,
    OpCode.JumpIfAndKeep,
    OpCode.JumpIfNotAndKeep,
    OpCode.BEqualsEqualsEquals,
    OpCode.CallValue,
    OpCode.PrefixExclamation,
    OpCode.BPlus,
    OpCode.ObjectLiteral,
    OpCode.ArrayLiteral,
    OpCode.SetKeepCtx,
    OpCode.NullLiteral,
]

const privilegedFamilySet = new Set<OpCode>(PRIVILEGED_OPCODE_FAMILIES)
const hotFamilySet = new Set<OpCode>(HOT_OPCODE_FAMILIES)
const warmFamilySet = new Set<OpCode>(WARM_OPCODE_FAMILIES)

export const INLINE_EXECUTED_NOISE_FAMILIES: readonly OpCode[] = [OpCode.Nop]

const RUNTIME_PROJECTION_CANDIDATES: readonly RuntimeProjectionCandidate[] = [
    { opcode: OpCode.Literal, weight: 8, minStackDepth: 0 },
    { opcode: OpCode.UndefinedLiteral, weight: 18, minStackDepth: 0 },
    { opcode: OpCode.NullLiteral, weight: 6, minStackDepth: 0 },
    { opcode: OpCode.Nop, weight: 6, minStackDepth: 0 },
    { opcode: OpCode.GetRecord, weight: 4, minStackDepth: 0 },
    { opcode: OpCode.ArrayLiteral, weight: 2, minStackDepth: 0 },
    { opcode: OpCode.ObjectLiteral, weight: 2, minStackDepth: 0 },
    { opcode: OpCode.Pop, weight: 10, minStackDepth: 1 },
    { opcode: OpCode.Duplicate, weight: 4, minStackDepth: 1 },
    { opcode: OpCode.SetEvalResult, weight: 3, minStackDepth: 1 },
    { opcode: OpCode.PrefixExclamation, weight: 4, minStackDepth: 1 },
    { opcode: OpCode.PrefixUnaryPlus, weight: 2, minStackDepth: 1 },
    { opcode: OpCode.PrefixUnaryMinus, weight: 2, minStackDepth: 1 },
    { opcode: OpCode.PrefixTilde, weight: 2, minStackDepth: 1 },
    { opcode: OpCode.Typeof, weight: 3, minStackDepth: 1 },
    { opcode: OpCode.BEqualsEqualsEquals, weight: 3, minStackDepth: 2 },
    { opcode: OpCode.BExclamationEqualsEquals, weight: 2, minStackDepth: 2 },
    { opcode: OpCode.BPlus, weight: 3, minStackDepth: 2 },
    { opcode: OpCode.BMinus, weight: 2, minStackDepth: 2 },
    { opcode: OpCode.BAmpersand, weight: 1, minStackDepth: 2 },
    { opcode: OpCode.BBar, weight: 1, minStackDepth: 2 },
    { opcode: OpCode.BCaret, weight: 1, minStackDepth: 2 },
]

const projectedRuntimeOpcodeKeepSet = Array.from(
    new Set(RUNTIME_PROJECTION_CANDIDATES.map((candidate) => candidate.opcode))
)

const PROJECTED_SMALL_LITERAL_VALUES = [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    9,
    10,
    12,
    16,
    24,
    32,
    64,
    128,
] as const

export function getCanonicalOpcodeFamily(op: number): OpCode {
    if (op < 0 || op >= OpCode._COUNT) {
        return op as OpCode
    }
    return canonicalOpcodeFamilyByMember[op]!
}

export function getOpcodeFamilyMembers(op: number): readonly OpCode[] {
    const family = getCanonicalOpcodeFamily(op)
    return opcodeFamilyMembers[family] ?? [family]
}

export function getOpcodeWordArity(op: number): 1 | 2 | 3 {
    const family = getCanonicalOpcodeFamily(op)
    if (family === OpCode.Literal) {
        return 2
    }
    if (family === OpCode.ProtectedLiteral) {
        return 3
    }
    return 1
}

export function isPrivilegedOpcodeFamily(op: number): boolean {
    return privilegedFamilySet.has(getCanonicalOpcodeFamily(op))
}

export function getOpcodeSafetyClass(op: number): OpcodeSafetyClass {
    const family = getCanonicalOpcodeFamily(op)
    if (privilegedFamilySet.has(family)) {
        return 'privileged'
    }
    if (hotFamilySet.has(family)) {
        return 'hot'
    }
    if (warmFamilySet.has(family)) {
        return 'warm'
    }
    return 'cold'
}

function mixProjectionWord(decodedWord: number, projectionSalt: number): number {
    let x = (decodedWord ^ projectionSalt) | 0
    x ^= x >>> 16
    x = Math.imul(x, 0x7feb352d)
    x ^= x >>> 15
    x = Math.imul(x, 0x846ca68b)
    x ^= x >>> 16
    return x >>> 0
}

export function getProjectedRuntimeOpcode(decodedWord: number, projectionSalt: number, stackDepth: number): OpCode {
    const applicable = RUNTIME_PROJECTION_CANDIDATES.filter((candidate) => stackDepth >= candidate.minStackDepth)
    const candidates = applicable.length > 0
        ? applicable
        : RUNTIME_PROJECTION_CANDIDATES.filter((candidate) => candidate.minStackDepth === 0)

    const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
    let pick = mixProjectionWord(decodedWord, projectionSalt) % totalWeight

    for (const candidate of candidates) {
        if (pick < candidate.weight) {
            return candidate.opcode
        }
        pick -= candidate.weight
    }

    return candidates[candidates.length - 1]!.opcode
}

export function getProjectedRuntimeOpcodeKeepSet(): readonly OpCode[] {
    return projectedRuntimeOpcodeKeepSet
}

export function getProjectedLiteralOperand(
    decodedOpcodeWord: number,
    projectionSalt: number,
    decodedOperandWord: number,
    operandPos: number
): number {
    const mixed = mixProjectionWord(
        (decodedOperandWord ^ Math.imul(operandPos + 1, 0x9e3779b9)) >>> 0,
        (projectionSalt ^ Math.imul(decodedOpcodeWord, 0x85ebca6b)) >>> 0
    )

    return PROJECTED_SMALL_LITERAL_VALUES[mixed % PROJECTED_SMALL_LITERAL_VALUES.length]!
}
