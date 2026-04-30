const maybeConfig = {
    title: 'Flat JS VM-in-VM demo',
    theme: {
        accent: 'lime'
    }
}

let keyCalls = 0
const key = () => {
    keyCalls += 1
    return 'missing'
}

const skipped = undefined?.[key()]
const accent = maybeConfig.theme?.accent ?? 'white'

let score = 2 ** 5
score %= 13
score <<= 2

const state = {
    title: ''
}

state.title ||= maybeConfig.title
state.score ??= score

const lines = [
    state.title,
    'path=outer Flat VM -> inner self-contained Flat VM -> demo program',
    'accent=' + accent,
    'score=' + state.score,
    'optionalKeyCalls=' + keyCalls,
    'skipped=' + skipped
]

console.log(lines.join(' | '))

if (typeof document !== 'undefined') {
    const root = document.createElement('main')
    root.id = 'flat-self-contained-vm-demo'
    root.style.fontFamily = 'system-ui, sans-serif'
    root.style.maxWidth = '720px'
    root.style.margin = '48px auto'
    root.style.padding = '24px'
    root.style.border = '1px solid #ddd'
    root.style.borderRadius = '8px'

    const heading = document.createElement('h1')
    heading.textContent = state.title
    heading.style.marginTop = '0'

    const body = document.createElement('pre')
    body.textContent = lines.slice(1).join('\n')
    body.style.color = accent
    body.style.background = '#111'
    body.style.padding = '16px'
    body.style.overflowX = 'auto'

    root.appendChild(heading)
    root.appendChild(body)
    document.body.appendChild(root)
}
