const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const BUNDLE_PATH = path.join(ROOT, 'lib', 'compiler-with-typescript.cjs')

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message)
    }
}

const createSelfHostGlobal = (moduleRecord) => {
    const vmGlobal = Object.create(globalThis)
    Object.assign(vmGlobal, {
        module: moduleRecord,
        exports: moduleRecord.exports,
        require,
        Buffer,
        process,
        __filename: BUNDLE_PATH,
        __dirname: path.dirname(BUNDLE_PATH),
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        console,
    })
    vmGlobal.globalThis = vmGlobal
    return vmGlobal
}

const main = () => {
    assert(fs.existsSync(BUNDLE_PATH), `Missing compiler bundle: ${BUNDLE_PATH}`)

    console.log(`Loading native compiler bundle: ${path.relative(ROOT, BUNDLE_PATH)}`)
    const nativeCompiler = require(BUNDLE_PATH)
    const [nativeProgram, nativeInfo] = nativeCompiler.compile('1+1', { evalMode: true })
    assert(Array.isArray(nativeProgram), 'native bundled compiler did not return program data')
    assert(typeof nativeInfo.codeLength === 'number', 'native bundled compiler did not return debug info')

    const { compile } = require(path.join(ROOT, 'lib', 'compiler'))
    const { run } = require(path.join(ROOT, 'lib', 'runtime'))
    const bundleSource = fs.readFileSync(BUNDLE_PATH, 'utf8')

    console.log('Compiling compiler bundle with Flat JS')
    const startedCompile = Date.now()
    const [selfHostProgram, selfHostInfo] = compile(bundleSource, { range: false })
    console.log(`Compiled ${selfHostProgram.length} words (${selfHostInfo.codeLength} code words) in ${Date.now() - startedCompile}ms`)

    console.log('Executing compiler bundle in Flat JS VM')
    const moduleRecord = {
        exports: {},
        children: [],
        paths: [],
    }
    moduleRecord.require = require
    const vmGlobal = createSelfHostGlobal(moduleRecord)
    const startedRun = Date.now()
    run(selfHostProgram, 0, vmGlobal, [], undefined, [], compile)
    console.log(`Executed compiler bundle in ${Date.now() - startedRun}ms`)

    assert(typeof moduleRecord.exports.compile === 'function', 'VM compiler bundle did not export compile')
    const [vmProgram, vmInfo] = moduleRecord.exports.compile('1+1', { evalMode: true })
    assert(Array.isArray(vmProgram), 'VM compiler did not return program data')
    assert(typeof vmInfo.codeLength === 'number', 'VM compiler did not return debug info')
    console.log(`VM compiler produced ${vmProgram.length} words (${vmInfo.codeLength} code words)`)
}

main()
