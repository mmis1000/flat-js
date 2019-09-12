const template = require("babel-template");
const Part = require("./part");
const forceConsequenseBlockStatement = require("./traversors/forceConsequenseBlockStatement");
const escapeControlInLoop = require("./traversors/escapeControlInLoop");
const replaceCondition = require("./traversors/replaceCondition");
const splitAction = require("./traversors/splitAction");
const declaretionHoist = require("./traversors/declaretionHoist");
const collectFunctions = require("./traversors/collectFunctions");
const rewriteIdentifier = require("./traversors/rewriteIdentifier");
const markInvoke = require("./traversors/markInvoke");
const resolveInvoke = require("./traversors/resolveInvoke");
const preGenerate = require("./pre-generate")
const fs = require('fs')

module.exports = function (babel) {
  let t = babel.types;
  return {
    visitor: {
      Program(path) {
        // console.log(path)
        // console.log(path);
        /*path.node.body.unshift(babel.transform('function binaryOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function assignmentOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function getReference() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function unaryOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function updateOperate() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function getValue() {}').ast.program.body[0]);
        path.node.body.unshift(babel.transform('function invokeExpression() {}').ast.program.body[0]);
        */

        var state = {};

        state.whiteListed = {
          binaryOperate: true,
          assignmentOperate: true,
          getReference: true,
          unaryOperate: true,
          updateOperate: true,
          getValue: true,
          invokeExpression: true
        }
        state.functions = [];
        state.functionIndex = 0;

        path.traverse(forceConsequenseBlockStatement(t), state);
        path.traverse(escapeControlInLoop(t), state);
        path.traverse(replaceCondition(t), state);
        path.traverse(splitAction(t), state);
        path.traverse(declaretionHoist(t), state);
        // path.traverse(rewriteIdentifier(t), state);
        // path.traverse(markInvoke(t), state);
        // path.traverse(resolveInvoke(t), state);
        path.traverse(collectFunctions(t), state);

        var functionParts = split([path.node].concat(state.functions))

        var index = 0;

        functionParts.forEach(function (parts) {
          unwrapControlStatement(parts, t);
          parts.forEach(function (part) {
            part.label = index++;
          })
        });
        //logParts(functionParts)
        console.log('there are ' + state.functions.length + ' functions in this program')

        var irs = preGenerate(functionParts, t)
        var main = fs.readFileSync(__dirname + '/client-lib/main.js', { encoding: "utf8" })

        path.node.body = [
          template(main)({
            __CODE_PARTS__: template(JSON.stringify(irs))().expression
          })
        ]
      },
    }
  }
}

function split(functions) {
  // console.log(functions)
  var parts = functions.map(function (item) {
    let nodes, parts;

    if (item.type === "Program") {
      nodes = item.body.slice(0);
    } else {
      nodes = item.body.body.slice(0)
    }

    parts = nodes.map(function (node) {
      return new Part('general', [node], null, null, null, null)
    })

    parts.forEach(function (part, index) {
      if (index === 0) return;
      Part.link(parts[index - 1], part)
    })

    parts.unshift(new Part('entry', [], null, null, null, null))

    parts[0].info = {
      node: item
    }

    Part.link(parts[0], parts[1])

    return parts
  })
  return parts;
}


const unwrapWhile = require('./node-expander/while');
const unwrapLabel = require('./node-expander/label');
const unwrapBreak = require('./node-expander/break');
const unwrapIfElse = require('./node-expander/if-else');
// const unwrapWhile = require('./node-expander/while');
function unwrapControlStatement(parts, t) {
  var touched = false;

  do {
    touched = false;
    touched = touched || unwrapLabel(t, parts)
    touched = touched || unwrapWhile(t, parts)
    touched = touched || unwrapBreak(t, parts)
    touched = touched || unwrapIfElse(t, parts)
  } while (touched)

  return parts;
}

function logParts(partss) {
  partss = partss.map(function (parts) {
    return parts.map(function (part) {
      return {
        id: part.label,
        type: part.type,
        prevs: part.prevs.map((i) => i.label),
        next: part.next && part.next.label,
        alt: part.alt && part.alt.label,
        condition: !!part.condition,
        nodes: part.nodes.length
      }
    })
  })
  console.log(JSON.stringify(partss, 0, 4));
}