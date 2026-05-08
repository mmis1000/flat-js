const fs = require('fs')
const path = require('path')
const { buildSerializationPlaygroundExampleSnapshotText } = require('../lib/serialization-playground-example')

const OUTPUT_PATH = path.resolve(__dirname, '..', 'example', 'serialization-playground-snapshot.json')

const snapshotText = buildSerializationPlaygroundExampleSnapshotText()
fs.writeFileSync(OUTPUT_PATH, `${snapshotText}\n`)
console.log(`Wrote ${path.relative(path.resolve(__dirname, '..'), OUTPUT_PATH)}`)
