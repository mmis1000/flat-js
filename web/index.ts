import { compile, run } from '../src'

function print (val: any) {
    document.getElementById('result')!.textContent += JSON.stringify(val, undefined, 2) + '\n'
}

document.getElementById('run')?.addEventListener('click', (ev) => {
    const textEl = document.getElementById('code') as HTMLTextAreaElement
    const text = textEl.value

    const [programData, textData] = compile(text)
    run(programData, textData, 0, [globalThis, { print }])
})

const example = `const start = Date.now()
let a = 0
for (let i = 0; i < 1000; i++) {
  a = a + i
}
print(a)
print('total time: ' + (Date.now() - start) + 'ms')
alert('CSP just can\\'t stop me')
debugger`

;(document.getElementById('code') as HTMLTextAreaElement).value = example


try {
    eval('console.log("CSP does not work")')
} catch (err) {
    console.log("CSP do work")
}