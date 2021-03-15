import { compile } from "./compiler"
import { run } from "./runtime"


function compileAndRun(src: string) {
    const [programData, textData] = compile(src, true)
    console.log(JSON.stringify(textData))
    console.log(programData.length, Buffer.from(new Uint32Array(programData).buffer).toString('base64'))
    console.time()
    run(programData, textData, 0, [globalThis, {
        location: {
            href: 'AAAA'
        }
    }])
    console.timeEnd()
}

// compileAndRun(`
// try {
//     try {
//         throw 1
//     } catch (err) {
//         console.log(err)
//         throw err + 1
//     }
// } catch (err) {
//     console.log(err)
// }
// `)

compileAndRun(`
console.log(0, 1, 2) = 3
`)