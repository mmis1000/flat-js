import { promises as fs } from "fs"
import * as path from "path"
import { compile } from "./compiler"
import * as uglify from 'terser'

const START_FLAG = '// [START_HERE]'
const END_FLAG = 'exports.run = run;'
const replaces = [
    ['exports.getExecution = getExecution;', ''] as [string, string]
]
const args = process.argv.slice(2)

const flags: Record<string, boolean> = {}

while (args[0] && args[0].startsWith('--')) {
    flags[args.shift()!] = true
}

const debugMode = flags['--debug'] || false
const JSONMode = flags['--json'] || false
const noMinimize = flags['--pretty'] || false
const filename = args[0]

async function main () {
    const runtimeFull = await fs.readFile(path.resolve(__dirname, './runtime.js'),{ encoding: 'utf-8' })
    const startPos = runtimeFull.indexOf(START_FLAG)
    const endPos = runtimeFull.indexOf(END_FLAG)
    let runtime = runtimeFull.slice(startPos, endPos)

    for (let [from, to] of replaces) {
        runtime = runtime.replace(from, to)
    }

    const content = await fs.readFile(filename, { encoding: 'utf-8' })
    const contentMinimized = noMinimize ? content : (await uglify.minify(content, {
        compress: {
            drop_debugger: false,
        },
        output: {
            beautify: debugMode
        }
    })).code

    if (debugMode && !noMinimize) {
        console.error(contentMinimized)
    }

    if (!contentMinimized) {
        throw new Error('fail to minimize')
    }

    const [programDataRaw, textDataRaw] = compile(contentMinimized, {
        debug: debugMode,
        range: debugMode
    })
    const textData = JSON.stringify(textDataRaw)
    const programData = Buffer.from(new Uint32Array(programDataRaw).buffer).toString('base64')

    if (!JSONMode) {
        const postFix = `const textData = ${textData}
const programData = new Int32Array(Uint8Array.from(atob('${programData}'), c => c.charCodeAt(0)).buffer)
run(programData, textData, 0, globalThis, [{ _$_: run }])
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
            t: textDataRaw,
        }
        console.log(JSON.stringify(result))
    }
}

main()