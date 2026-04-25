import { promises as fs } from "fs"
import * as path from "path"
import { gzipSync } from "zlib"
import { collectUsedOpcodes, compile } from "./compiler"
import { stripRuntimeCommandSwitch } from "./strip-runtime-opcodes"
import * as uglify from 'terser'

const START_FLAG = '// [START_HERE]'
const END_FLAG = 'exports.run = run;'
const replaces = [
    ['exports.getExecution = getExecution;', ''] as [string, string]
]

const argv = process.argv.slice(2)
const flags: Record<string, boolean> = {}
const mergeOpcodePaths: string[] = []

let i = 0
while (i < argv.length) {
    const a = argv[i]
    if (a === '--merge-opcodes-from') {
        if (i + 1 >= argv.length) {
            throw new Error('--merge-opcodes-from requires a path')
        }
        mergeOpcodePaths.push(argv[i + 1]!)
        i += 2
        continue
    }
    if (a!.startsWith('--')) {
        flags[a!] = true
        i++
        continue
    }
    break
}

const filename = argv[i]
if (!filename) {
    throw new Error('missing input file')
}

const debugMode = flags['--debug'] || false
const JSONMode = flags['--json'] || false
const binMode = flags['--bin'] || false
const noMinimize = flags['--pretty'] || false
const stripRuntime = flags['--strip-runtime'] || false
const gzipBin = flags['--gzip'] || false

if (gzipBin && !binMode) {
    throw new Error('--gzip is only valid with --bin')
}

async function minifyInput(source: string): Promise<string> {
    if (noMinimize) {
        return source
    }
    const r = await uglify.minify(source, {
        compress: {
            drop_debugger: false,
        },
        output: {
            beautify: debugMode
        }
    })
    if (!r.code) {
        throw new Error('fail to minimize')
    }
    return r.code
}

async function main () {
    const runtimeFull = await fs.readFile(path.resolve(__dirname, './runtime-inline.js'),{ encoding: 'utf-8' })
    const startPos = runtimeFull.indexOf(START_FLAG)
    const endPos = runtimeFull.indexOf(END_FLAG)
    let runtime = runtimeFull.slice(startPos, endPos)

    for (let [from, to] of replaces) {
        runtime = runtime.replace(from, to)
    }

    const content = await fs.readFile(filename, { encoding: 'utf-8' })
    const contentMinimized = await minifyInput(content)

    if (debugMode && !noMinimize) {
        console.error(contentMinimized)
    }

    if (!contentMinimized) {
        throw new Error('fail to minimize')
    }

    const compileOpts = { debug: debugMode, range: debugMode }
    const [programDataRaw, compileInfo] = compile(contentMinimized, compileOpts)
    const programBytes = Buffer.from(new Uint32Array(programDataRaw).buffer)
    const programData = programBytes.toString('base64')

    if (binMode) {
        const out = gzipBin ? gzipSync(programBytes) : programBytes
        process.stdout.write(out)
        return
    }

    if (stripRuntime) {
        const opcodeSet = new Set(collectUsedOpcodes(programDataRaw, compileInfo.codeLength))
        for (const extra of mergeOpcodePaths) {
            const extraSrc = await fs.readFile(extra, { encoding: 'utf-8' })
            const extraMin = await minifyInput(extraSrc)
            if (!extraMin) {
                throw new Error('fail to minimize')
            }
            const [extraProg, extraInfo] = compile(extraMin, compileOpts)
            for (const n of collectUsedOpcodes(extraProg, extraInfo.codeLength)) {
                opcodeSet.add(n)
            }
        }
        runtime = stripRuntimeCommandSwitch(runtime, opcodeSet)
    }

    if (!JSONMode) {
        const postFix = `const programData = new Int32Array(Uint8Array.from(atob('${programData}'), c => c.charCodeAt(0)).buffer)
run(programData, 0, globalThis, [{ _$_: run }])
`
        const joined = '{\r\n' + runtime + postFix + '}\r\n'
        if (noMinimize) {
            console.log(joined)
        } else {
            const res = await uglify.minify(joined, {
                compress: {
                    drop_debugger: false,
                },
                output: {
                    beautify: debugMode
                }
            })

            if (!res.code) {
                throw new Error('fail to minimize')
            }

            console.log(res.code)
        }
    } else {
        const result = {
            p: programData,
        }
        console.log(JSON.stringify(result))
    }
}

main()
