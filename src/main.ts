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
// var string = 'string'
// let string1:string  = 'string'
// function test () {}
// const a = () => {}
// const c = (a) => 0
// console.log(1, 2)
// const log = 'log'
// console[log](1, 2, 'Hello World')
// const b = function (f, u ,g) {
//     console[log](1, 2, 'Hello World 3')
// }
// const k = function (fn) {
//     fn()
// }
// {
//     let c = 0
//     console.log(c)
//     {
//         let c = false ? -1 : 1
//         console.log(c)
//         {
//             let c = true ? 2 : -1
//             console.log(c)
//             b()
//             k(b)
//         }
//         console.log(c)
//     }
//     console.log(c)
// }
// console.log(c)
// console.log(e)
// var e= 0
// `)

// compileAndRun(`
// var a = [1, 2]
// var b = [1, 2,]
// var c = [1,, 2]
// var d = {}
// var e = {
//     a: 1,
//     ['b']: 2,
//     'c': 3, 
//     d(e) { return e},
//     e: {
//         nested: true
//     }
// }
// console.log(a, b, c, d, e)
// `)

// compileAndRun(`
// let t;

// var a = function(){
//     var c;
//     var l = [];
//     for(var n =0; n < 256; n++){
//         c = n;
//         for(var k =0; k < 8; k++){
//             c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
//         }
//         l[n] = c;
//     }
//     return l;
// }

// var b = function(s) {
//     var m = t || (t = a());
//     var n = 0 ^ (-1);

//     for (var i = 0; i < s.length; i++ ) {
//         n = (n >>> 8) ^ m[(n ^ s.charCodeAt(i)) & 0xFF];
//     }

//     return (n ^ (-1)) >>> 0;
// };
// console.log(b(location.href))
// `)


// compileAndRun(`
// const fns = []
// for (let i = 0; i < 15; i++) {
//     let c = 0
//     fns.push({
//         a: () => c++,
//         b () {
//             debugger
//             return i + c
//         }
//     })
// }
// fns[7].a()
// console.log(fns[7].b() + fns[8].b())
// `)

// compileAndRun(`
// let a = 0, b;
// a = 1
// `)

// compileAndRun(`
// const a = { b () { return 1 } };
// console.log(a.b());
// `)
// compileAndRun(`
// console.log(a());
// function a () { return 0 };
// `)
// compileAndRun(`
// const a = {
//     a: 'content of a',
//     b () {
//         console.log(this.a)
//     }
// }
// a.b()
// `)

compileAndRun(`
try {
    try {
        throw 1
    } catch (err) {
        console.log(err)
        throw err + 1
    }
} catch (err) {
    console.log(err)
}
`)