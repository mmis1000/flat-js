const fs = require('fs')
const path = require('path')
const {
    buildSerializationPlaygroundCheckpointHistoryExampleText,
    buildSerializationPlaygroundExampleSnapshotText,
} = require('../lib/serialization-playground-example')

const SNAPSHOT_OUTPUT_PATH = path.resolve(__dirname, '..', 'example', 'serialization-playground-snapshot.json')
const CHECKPOINT_HISTORY_OUTPUT_PATH = path.resolve(__dirname, '..', 'example', 'serialization-playground-checkpoint-history.json')

const outputs = [
    [SNAPSHOT_OUTPUT_PATH, buildSerializationPlaygroundExampleSnapshotText()],
    [CHECKPOINT_HISTORY_OUTPUT_PATH, buildSerializationPlaygroundCheckpointHistoryExampleText()],
]

for (const [outputPath, text] of outputs) {
    fs.writeFileSync(outputPath, `${text}\n`)
    console.log(`Wrote ${path.relative(path.resolve(__dirname, '..'), outputPath)}`)
}
