const { OpCode } = require('../lib/compiler');
for (const [key, value] of Object.entries(OpCode)) {
    if (isNaN(key)) {
        console.log(`${key}: ${value}`);
    }
}
