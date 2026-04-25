import { stripRuntimeCommandSwitch } from '../strip-runtime-opcodes'

test('stripRuntimeCommandSwitch also strips opcode-family handler switches', () => {
    const source = `
const handleBasicOpcode = (command, ctx) => {
    switch (command) {
        case 1:
            ctx.basic = 1
            break
        case 2:
            ctx.basic = 2
            break
    }
}
const handleValueOpcode = (command, ctx) => {
    switch (command) {
        case 10:
            ctx.value = 10
            break
        case 11:
            ctx.value = 11
            break
        default:
            ctx.value = 99
    }
}
command: switch (command) {
    case 1:
        handleBasicOpcode(command, ctx)
        break
    case 10:
        handleValueOpcode(command, ctx)
        break
    case 11:
        handleValueOpcode(command, ctx)
        break
    default:
        fallback()
}
`

    const stripped = stripRuntimeCommandSwitch(source, new Set([1, 10]))

    expect(stripped).toContain('case 1:')
    expect(stripped).toContain('case 10:')
    expect(stripped).not.toContain('case 2:')
    expect(stripped).not.toContain('case 11:')
    expect(stripped).toContain('default:')
})
