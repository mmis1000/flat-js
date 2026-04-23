const { spawnSync } = require('child_process')
const path = require('path')

const env = { ...process.env }
const jestArgs = [
    path.join(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js'),
    '--runInBand',
]

for (const arg of process.argv.slice(2)) {
    const eq = arg.indexOf('=')
    if (eq <= 0) {
        jestArgs.push(arg)
        continue
    }
    env[arg.slice(0, eq)] = arg.slice(eq + 1)
}

const result = spawnSync(process.execPath, jestArgs, {
    stdio: 'inherit',
    env,
})

if (result.error) {
    throw result.error
}

process.exit(result.status ?? 1)
