import { promises as fs } from "fs"
import * as path from "path"
import { compile } from "./compiler"
import * as uglify from 'uglify-js'

const START_FLAG = '// [START_HERE]'
const END_FLAG = 'exports.run = run;'

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
    const runtime = runtimeFull.slice(startPos, endPos)

    const content = await fs.readFile(filename, { encoding: 'utf-8' })
    const contentMinimized = noMinimize ? content : uglify.minify(content).code

    if (debugMode && !noMinimize) {
        console.error(contentMinimized)
    }

    const [programDataRaw, textDataRaw] = compile(contentMinimized, debugMode, debugMode)
    const textData = JSON.stringify(textDataRaw)
    const programData = Buffer.from(new Uint32Array(programDataRaw).buffer).toString('base64')

    if (!JSONMode) {
        const postFix = `const textData = ${textData}
const programData = new Int32Array(Uint8Array.from(atob('${programData}'), c => c.charCodeAt(0)).buffer)
run(programData, textData, 0, [globalThis, { _$_: run }])
    `
        const joined = '{\r\n' + runtime + postFix + '}\r\n'
        if (noMinimize) {
            console.log(joined)
        } else {
            const res = uglify.minify(joined)
            if (res.error) {
                throw res.error
            } else {
                console.log(res.code)
            }
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