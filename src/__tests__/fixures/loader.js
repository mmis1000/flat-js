function gunzipToArrayBuffer (buf) {
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
}

fetch('./jquery.bin.gz')
.then(it => it.arrayBuffer())
.then(gunzipToArrayBuffer)
.then(buf => {
    _$_(
        new Int32Array(buf),
        0,
        globalThis,
        [{ _$_ }]
    )

    return fetch('./bad-code.bin.gz')
})
.then(it => it.arrayBuffer())
.then(gunzipToArrayBuffer)
.then(buf => _$_(
        new Int32Array(buf),
        0,
        globalThis,
        [{ _$_ }]
    )
)