// Standalone runtime builds slice away their module prologue before embedding,
// so any compiler helpers used after `// [START_HERE]` must live in runtime-local
// source. Keep these definitions in sync with the compiler-side helpers.

const PROTECTED_LITERAL_CHECK_TAG = 0x504c4954
const PROGRAM_PROTECTED_MODE_TRAILER = 0x50524f54
const PROGRAM_PROTECTED_MODE_METADATA_WORDS = 3

const enum ProjectedOpcode {
    Nop = 0,
    Literal = 1,
    NullLiteral = 2,
    UndefinedLiteral = 3,
    Pop = 14,
    SetEvalResult = 15,
    Duplicate = 16,
    GetRecord = 17,
    Typeof = 45,
    ArrayLiteral = 54,
    ObjectLiteral = 55,
    BPlus = 58,
    BMinus = 59,
    BCaret = 60,
    BAmpersand = 61,
    BBar = 62,
    BEqualsEqualsEquals = 71,
    BExclamationEqualsEquals = 73,
    PrefixUnaryPlus = 97,
    PrefixUnaryMinus = 98,
    PrefixExclamation = 99,
    PrefixTilde = 100,
}

const mixWord = (x: number): number => {
    x |= 0
    x ^= x >>> 16
    x = Math.imul(x, 0x7feb352d)
    x ^= x >>> 15
    x = Math.imul(x, 0x846ca68b)
    x ^= x >>> 16
    return x >>> 0
}

export const TEXT_DADA_MASK = 0x80000000

export const isSmallNumber = (a: any): a is number =>
    typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0)

/** MUST SYNC with compiler/shared.ts `literalPoolWordMask`. */
export const literalPoolWordMask = (i: number): number => {
    const x = (i * 0x9e3779b9 | 0) ^ (i >>> 1) ^ (i << 3)
    return (x ^ (x >>> 15) ^ (x << 15)) | 0
}

/** MUST SYNC with compiler/shared.ts `protectedLiteralSiteMix`. */
export const protectedLiteralSiteMix = (operandPos: number, globalSeed: number): number =>
    mixWord((globalSeed ^ Math.imul(operandPos + 1, 0x9e3779b9) ^ 0x51ed270b) | 0) >>> 0

/** MUST SYNC with compiler/shared.ts `protectedLiteralWordMask`. */
export const protectedLiteralWordMask = (literalSeed: number, absolutePos: number, wordOffset: number): number =>
    mixWord((literalSeed ^ Math.imul(absolutePos + 1, 0x9e3779b9) ^ Math.imul(wordOffset + 1, 0x85ebca6b)) | 0) | 0

/** MUST SYNC with compiler/shared.ts `protectedLiteralCheck`. */
export const protectedLiteralCheck = (literalSeed: number, words: readonly number[]): number => {
    let acc = (literalSeed ^ PROTECTED_LITERAL_CHECK_TAG ^ Math.imul(words.length, 0x9e3779b9)) >>> 0
    for (let index = 0; index < words.length; index++) {
        acc = mixWord((acc ^ (words[index]! >>> 0) ^ Math.imul(index + 1, 0x85ebca6b)) >>> 0)
    }
    return acc | 0
}

/** MUST SYNC with compiler/shared.ts `isProtectedModeProgram`. */
export const isProtectedModeProgram = (program: readonly number[]): boolean =>
    program.length >= PROGRAM_PROTECTED_MODE_METADATA_WORDS
    && program[program.length - 1] === (PROGRAM_PROTECTED_MODE_TRAILER | 0)

/** MUST SYNC with compiler/shared.ts `getProgramSeedWord`. */
export const getProgramSeedWord = (program: readonly number[]): number =>
    program[isProtectedModeProgram(program) ? program.length - PROGRAM_PROTECTED_MODE_METADATA_WORDS : program.length - 1]! >>> 0

/** MUST SYNC with compiler/shared.ts `getProgramMetadataStart`. */
export const getProgramMetadataStart = (program: readonly number[]): number =>
    isProtectedModeProgram(program)
        ? program.length - PROGRAM_PROTECTED_MODE_METADATA_WORDS
        : program.length - 1

const RUNTIME_PROJECTION_CANDIDATE_WORDS = [
    ProjectedOpcode.Literal, 8, 0,
    ProjectedOpcode.UndefinedLiteral, 18, 0,
    ProjectedOpcode.NullLiteral, 6, 0,
    ProjectedOpcode.Nop, 6, 0,
    ProjectedOpcode.GetRecord, 4, 0,
    ProjectedOpcode.ArrayLiteral, 2, 0,
    ProjectedOpcode.ObjectLiteral, 2, 0,
    ProjectedOpcode.Pop, 10, 1,
    ProjectedOpcode.Duplicate, 4, 1,
    ProjectedOpcode.SetEvalResult, 3, 1,
    ProjectedOpcode.PrefixExclamation, 4, 1,
    ProjectedOpcode.PrefixUnaryPlus, 2, 1,
    ProjectedOpcode.PrefixUnaryMinus, 2, 1,
    ProjectedOpcode.PrefixTilde, 2, 1,
    ProjectedOpcode.Typeof, 3, 1,
    ProjectedOpcode.BEqualsEqualsEquals, 3, 2,
    ProjectedOpcode.BExclamationEqualsEquals, 2, 2,
    ProjectedOpcode.BPlus, 3, 2,
    ProjectedOpcode.BMinus, 2, 2,
    ProjectedOpcode.BAmpersand, 1, 2,
    ProjectedOpcode.BBar, 1, 2,
    ProjectedOpcode.BCaret, 1, 2,
] as const

const RUNTIME_PROJECTION_CANDIDATE_STRIDE = 3

const mixProjectionWord = (decodedWord: number, projectionSalt: number): number => {
    let x = (decodedWord ^ projectionSalt) | 0
    x ^= x >>> 16
    x = Math.imul(x, 0x7feb352d)
    x ^= x >>> 15
    x = Math.imul(x, 0x846ca68b)
    x ^= x >>> 16
    return x >>> 0
}

/** MUST SYNC with compiler/opcode-families.ts `getProjectedRuntimeOpcode`. */
export const getProjectedRuntimeOpcode = (decodedWord: number, projectionSalt: number, stackDepth: number): number => {
    let totalWeight = 0
    let fallbackWeight = 0
    let hasApplicable = false

    for (let index = 0; index < RUNTIME_PROJECTION_CANDIDATE_WORDS.length; index += RUNTIME_PROJECTION_CANDIDATE_STRIDE) {
        const weight = RUNTIME_PROJECTION_CANDIDATE_WORDS[index + 1]!
        const minStackDepth = RUNTIME_PROJECTION_CANDIDATE_WORDS[index + 2]!
        if (stackDepth >= minStackDepth) {
            totalWeight += weight
            hasApplicable = true
        }
        if (minStackDepth === 0) {
            fallbackWeight += weight
        }
    }

    let pick = mixProjectionWord(decodedWord, projectionSalt) % (hasApplicable ? totalWeight : fallbackWeight)

    for (let index = 0; index < RUNTIME_PROJECTION_CANDIDATE_WORDS.length; index += RUNTIME_PROJECTION_CANDIDATE_STRIDE) {
        const opcode = RUNTIME_PROJECTION_CANDIDATE_WORDS[index]!
        const weight = RUNTIME_PROJECTION_CANDIDATE_WORDS[index + 1]!
        const minStackDepth = RUNTIME_PROJECTION_CANDIDATE_WORDS[index + 2]!
        if (hasApplicable ? stackDepth < minStackDepth : minStackDepth !== 0) {
            continue
        }
        if (pick < weight) {
            return opcode
        }
        pick -= weight
    }

    return hasApplicable ? ProjectedOpcode.BCaret : ProjectedOpcode.Nop
}

const getProjectedSmallLiteralValue = (index: number): number => {
    switch (index % 17) {
        case 0: return 0
        case 1: return 1
        case 2: return 2
        case 3: return 3
        case 4: return 4
        case 5: return 5
        case 6: return 6
        case 7: return 7
        case 8: return 8
        case 9: return 9
        case 10: return 10
        case 11: return 12
        case 12: return 16
        case 13: return 24
        case 14: return 32
        case 15: return 64
        default: return 128
    }
}

/** MUST SYNC with compiler/opcode-families.ts `getProjectedLiteralOperand`. */
export const getProjectedLiteralOperand = (
    decodedOpcodeWord: number,
    projectionSalt: number,
    decodedOperandWord: number,
    operandPos: number
): number => {
    const mixed = mixProjectionWord(
        (decodedOperandWord ^ Math.imul(operandPos + 1, 0x9e3779b9)) >>> 0,
        (projectionSalt ^ Math.imul(decodedOpcodeWord, 0x85ebca6b)) >>> 0
    )

    return getProjectedSmallLiteralValue(mixed)
}
