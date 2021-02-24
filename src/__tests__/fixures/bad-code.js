{
    console.log('I am a bad code')
    console.log('Spams your console')

    for (let i = 0; i < 15; i++) {
        console.log('A ' + i)
    }

    console.log('Change the page Style')
    document.body.style.background = 'black'
    document.body.style.color = 'white'

    console.log('Add random element and callback on element')
    const el = document.createElement('div')

    el.textContent = 'HACKED (click me)'
    el.style.background = 'rgba(255, 255, 255, 0.8)'
    el.style.borderRadius = '8px'
    el.style.border = '4px solid #eee'
    el.style.fontSize = '32px'
    el.style.fontFamily = 'SansSerif'
    el.style.color = 'red'
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.top = '50%'
    el.style.width = '200px'
    el.style.height = '100px'
    el.style.transform = 'translate(-50%, -50%)'

    let i = 0
    let cb

    el.addEventListener('click', cb = () => {
        alert('hacked ' + i);
        i++;
        if (i > 5) {
            el.removeEventListener('click', cb)
            alert('bye!');
        }
    })

    document.body.appendChild(el)
}