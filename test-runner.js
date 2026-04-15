global.test = (name, cb) => cb();
global.expect = (val) => ({
    toBe: (v) => { if (val !== v) throw new Error(`Expected ${v} but got ${val}`) }
});
require('./lib/__tests__/class.test.js');
console.log('Test passed!');
