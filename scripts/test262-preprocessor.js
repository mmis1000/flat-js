'use strict';

const path = require('path');
const vm = require('vm');
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
(() => {
  const __flatJsVm = require('vm');
  const { compileAndRun } = require(${JSON.stringify(flatEntry)});
  const __createFlatGlobal = () => {
    const context = __flatJsVm.createContext({ console, require });
    const vmGlobal = __flatJsVm.runInContext(\`
      const g = Object.create(globalThis);
      g.globalThis = g;
      g.print = function print(...args) {
        console.log(...args);
      };
      g.console = console;
      g.require = require;
      g;
    \`, context);
    function Test262Error(message) {
      const error = new Error(message || '');
      error.name = 'Test262Error';
      Object.setPrototypeOf(error, Test262Error.prototype);
      return error;
    }
    Test262Error.prototype = Object.create(Error.prototype);
    Test262Error.prototype.constructor = Test262Error;
    Test262Error.prototype.toString = function() {
      return 'Test262Error: ' + this.message;
    };
    Test262Error.thrower = function(message) {
      throw new Test262Error(message);
    };
    Object.defineProperty(vmGlobal, 'Test262Error', {
      configurable: true,
      writable: true,
      value: Test262Error,
    });
    Object.defineProperty(vmGlobal, 'eval', {
      configurable: true,
      writable: true,
      value(source) {
        return compileAndRun(String(source), vmGlobal);
      },
    });
    Object.defineProperty(vmGlobal, '$262', {
      configurable: true,
      writable: true,
      value: {
        evalScript(source) {
          return compileAndRun(String(source), vmGlobal);
        },
        createRealm() {
          return { global: __createFlatGlobal() };
        },
      },
    });
    return vmGlobal;
  };
  const vmGlobal = __createFlatGlobal();
  return compileAndRun(${JSON.stringify(src)}, vmGlobal);
})();
`;
  return test;
};
