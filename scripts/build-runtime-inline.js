const fs = require('fs')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const { OUTPUT_FILE, assembleRuntimeInline } = require('./assemble-runtime-inline')

const ROOT = path.resolve(__dirname, '..')
const TSC_BIN = require.resolve('typescript/bin/tsc')

const cleanupRuntimeInlineSource = () => {
    if (fs.existsSync(OUTPUT_FILE)) {
        fs.rmSync(OUTPUT_FILE, { force: true })
    }
}

const runTsc = (args) =>
    spawnSync(process.execPath, [TSC_BIN, '--project', './src/tsconfig.json', ...args], {
        cwd: ROOT,
        stdio: 'inherit',
    })

const runWatchTsc = (args) =>
    spawn(process.execPath, [TSC_BIN, '--project', './src/tsconfig.json', '--watch', ...args], {
        cwd: ROOT,
        stdio: 'inherit',
    })

const main = () => {
    const args = process.argv.slice(2)
    const watch = args.includes('--watch')
    const forwardArgs = args.filter((arg) => arg !== '--watch')

    cleanupRuntimeInlineSource()
    assembleRuntimeInline()

    if (watch) {
        const child = runWatchTsc(forwardArgs)
        let cleaned = false
        const cleanup = () => {
            if (!cleaned) {
                cleaned = true
                cleanupRuntimeInlineSource()
            }
        }
        const forwardSignal = (signal) => {
            child.kill(signal)
        }

        process.on('SIGINT', () => forwardSignal('SIGINT'))
        process.on('SIGTERM', () => forwardSignal('SIGTERM'))
        child.on('exit', (code) => {
            cleanup()
            process.exit(code ?? 0)
        })
        return
    }

    let exitCode = 0
    try {
        const result = runTsc(forwardArgs)
        if (result.error) {
            throw result.error
        }
        exitCode = result.status ?? 0
    } finally {
        cleanupRuntimeInlineSource()
    }

    process.exit(exitCode)
}

main()
