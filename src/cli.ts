import { promises as fs } from "fs"
import * as path from "path"
import { compile } from "./compiler"
import * as uglify from 'uglify-js'

const START_FLAG = '// [START_HERE]'
const END_FLAG = 'exports.run = run;'

const JSONMode = process.argv[2] === '--json'
const filename = process.argv[2] === '--json' ? process.argv[3]! : process.argv[2]!

async function main () {
    const runtimeFull = await fs.readFile(path.resolve(__dirname, './runtime.js'),{ encoding: 'utf-8' })
    const startPos = runtimeFull.indexOf(START_FLAG)
    const endPos = runtimeFull.indexOf(END_FLAG)
    const runtime = runtimeFull.slice(startPos, endPos)

    const content = await fs.readFile(filename, { encoding: 'utf-8' })
    const contentMinimized = uglify.minify(content).code

    const [programDataRaw, textDataRaw] = compile(contentMinimized)
    const textData = JSON.stringify(textDataRaw)
    const programData = Buffer.from(new Uint32Array(programDataRaw).buffer).toString('base64')

    if (!JSONMode) {
        const postFix = `const textData = ${textData}
const programData = new Int32Array(Uint8Array.from(atob('${programData}'), c => c.charCodeAt(0)).buffer)
run(programData, textData, 0, [globalThis])
globalThis._$_=run
    `
        const joined = '{\r\n' + runtime + postFix + '}\r\n'
        console.log(uglify.minify(joined).code)
    } else {
        const result = {
            p: programData,
            t: textDataRaw,
        }
        console.log(JSON.stringify(result))
    }
}

main()