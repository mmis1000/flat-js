import { compile } from "./compiler"
import { run } from "./runtime"


function compileAndRun(src: string) {
    console.time()
    run(...compile(src), 0, [globalThis])
    console.timeEnd()
}

compileAndRun(`
var string = 'string'
let string1:string  = 'string'
function test () {}
const a = () => {}
const c = (a) => 0
console.log(1, 2)
const log = 'log'
console[log](1, 2, 'Hello World')
const b = function (f, u ,g) {
    console[log](1, 2, 'Hello World 3')
}
const k = function (fn) {
    fn()
}
{
    let c = 0
    console.log(c)
    {
        let c = false ? -1 : 1
        console.log(c)
        {
            let c = true ? 2 : -1
            console.log(c)
            b()
            k(b)
        }
        console.log(c)
    }
    console.log(c)
}
console.log(c)
console.log(e)
var e= 0
`)

compileAndRun(`
var a = [1, 2]
var b = [1, 2,]
var c = [1,, 2]
var d = {}
var e = {
    a: 1,
    ['b']: 2,
    'c': 3, 
    d(e) { return e},
    e: {
        nested: true
    }
}
console.log(a, b, c, d, e)
`)

compileAndRun(`
let crcTable;

var makeCRCTable = function(){
    var c;
    var crcTable = [];
    for(var n =0; n < 256; n++){
        c = n;
        for(var k =0; k < 8; k++){
            c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        crcTable[n] = c;
    }
    return crcTable;
}

var crc32 = function(str) {
    var crcTable = crcTable || (crcTable = makeCRCTable());
    var crc = 0 ^ (-1);

    for (var i = 0; i < str.length; i++ ) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ str.charCodeAt(i)) & 0xFF];
    }

    return (crc ^ (-1)) >>> 0;
};
console.log(crc32('aaa'))
`)