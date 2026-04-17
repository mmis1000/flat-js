'use strict';

const path = require('path');
const { compile } = require(path.join(__dirname, '..', 'lib', 'compiler'));
const flatEntry = path.join(__dirname, '..', 'lib', 'index.js');

/**
 * Runs each Test262 case inside flat-js via compileAndRun instead of Node/vm.
 * Parse failures are reported as synthetic harness results (see test262-harness preprocessor docs).
 *
 * Note: the bundled harness (assert.js) contains template literals; the flat-js compiler must
 * support TemplateExpression for tests to execute past compile. Until then, many cases fail at compile.
 */
module.exports = function flatJsTest262Preprocessor(test) {
  const src = test.contents;
  try {
    compile(src, { evalMode: true });
  } catch (error) {
    test.result = {
      stderr: `${error.name}: ${error.message}\n`,
      stdout: '',
      error,
    };
    return test;
  }

  test.contents = `'use strict';
const { compileAndRun } = require(${JSON.stringify(flatEntry)});
// Host globals for Test262: eshost's Node agent puts print + a real globalThis on the VM context.
const vmGlobal = Object.create(globalThis);
vmGlobal.globalThis = vmGlobal;
vmGlobal.print = function print(...args) {
  console.log(...args);
};
compileAndRun(${JSON.stringify(src)}, vmGlobal);
`;
  return test;
};
