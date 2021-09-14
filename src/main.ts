import { compile } from "./compiler"
import { run } from "./runtime"


function compileAndRun(src: string) {
    const [programData, textData] = compile(src, { debug: true, evalMode: true })
    console.log(JSON.stringify(textData))
    console.log(programData.length, Buffer.from(new Uint32Array(programData).buffer).toString('base64'))
    console.time()
    const res = run(programData, textData, 0, globalThis, [{
        location: {
            href: 'AAAA'
        }
    }])
    console.timeEnd()
    return res
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

console.log(compileAndRun(`
do {
    try {
        throw 1
    } catch (err) {
        try {
            break
        } finally {
            console.log(2)
        }
        console.log('fail')
    } finally {
        debugger
        console.log(2.5)
    }
    console.log('fail')
} while (false)
`))