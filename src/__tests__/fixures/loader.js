fetch('./jquery.bin')
.then(it => it.arrayBuffer())
.then(buf => {
    _$_(
        new Int32Array(buf),
        0,
        globalThis,
        [{ _$_ }]
    )

    return fetch('./bad-code.bin')
})
.then(it => it.arrayBuffer())
.then(buf => _$_(
        new Int32Array(buf),
        0,
        globalThis,
        [{ _$_ }]
    )
)