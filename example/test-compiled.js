"use strict";

var t = void 0;
module.exports = function (babel) {
    t = babel.types;
    return {
        visitor: {
            /*
            BinaryExpression(path) {
              let node = path.node
                path.replaceWith(
                  t.callExpression(t.Identifier("binaryOperate"), [t.stringLiteral(node.operator) ,node.left, node.right])
                );
            },
            Program(path) {
              // console.log(path);
              console.log(babel.transform('function binaryOperate() {}').ast)
              path.node.body.unshift(babel.transform('function binaryOperate() {}').ast.program.body[0]);
            },*/
            FunctionDeclaration: function FunctionDeclaration(path) {
                transformFunction(path);
            },
            FunctionExpression: function FunctionExpression(path) {
                transformFunction(path);
            }
        }
    };
};

var Part = require("./lib/part");
var LoopContext = require("./lib/loop-context");
var NameContext = require("./lib/name-context");

function transformFunction(path) {
    var name = path.scope.generateUidIdentifier("_");
    var statements = path.node.body.body;
    var parts = split(statements);
    var nameContext = new NameContext(path);

    var prevLength = -1;
    while (prevLength !== parts.length) {
        prevLength = parts.length;
        for (var i = parts.length - 1; i >= 0; i--) {
            [].splice.apply(parts, [i, 1].concat(transform(parts[i], nameContext)));
        }
    }
    fixBreakAndContinueStatement(parts);

    for (var i = 0; i < parts.length; i++) {
        parts[i].originalIndex = i;
    }

    collapesParts(parts);

    // for too mini function
    if (parts.length <= 3) {
        return;
    }

    var newTree = t.BlockStatement(makeNewTree(parts, nameContext.get('_'), false));

    path.get('body').replaceWith(newTree);
}
function fixBreakAndContinueStatement(parts) {
    var part, loopContexts, targetContext;
    for (var i = 0; i < parts.length; i++) {
        part = parts[i];
        loopContexts = part.loopContexts;

        if (part.nodes.length > 0 && (part.nodes[0].type === 'BreakStatement' || parts[i].nodes[0].type === 'ContinueStatement')) {
            var label = part.nodes[0].label;
            var target;
            if (label) {
                targetContext = loopContexts.filter(function (context) {
                    return 0 <= context.labels.indexOf(label);
                })[0];
            } else {
                targetContext = loopContexts[loopContexts.length - 1];
            }
            if (part.nodes[0].type === 'BreakStatement') {
                target = targetContext.exit;
            } else {
                target = targetContext.entry;
            }
            // console.log('jump to ' + parts.indexOf(target))
            part.nodes = [];
            part.setPrevsOfNext(null);
            part.setNext(target);
        }
    }
}

function collapesParts(parts) {
    var blackedTypes = ['IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement', 'LabeledStatement', 'SwitchStatement'];
    for (var i = parts.length - 1; i >= 1; i--) {
        // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
        if (parts[i - 1].condition == null && parts[i - 1].next === parts[i] &&
        // parts[i].condition == null &&
        parts[i].prevs.length === 1 && parts[i].prevs[0] === parts[i - 1] && (parts[i].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i].nodes[0].type)) && (parts[i - 1].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i - 1].nodes[0].type))) {
            // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
            parts[i].concatPrev(parts[i - 1]);
            parts.splice(i - 1, 1);

            parts.forEach(function (i, index) {
                if (i.next != null) {
                    if (parts.indexOf(i.next) < 0) {
                        console.error(i, index);
                    }
                }
            });
        }
    }
}
function split(nodes) {
    var parts = [];
    parts = nodes.slice(0);
    parts = parts.map(function (i) {
        return new Part([i]);
    });
    for (var i = 0; i < parts.length; i++) {
        if (i !== 0) {
            parts[i].prevs.push(parts[i - 1]);
        }
        if (i !== parts.length - 1) {
            parts[i].next = parts[i + 1];
        }
    }

    return parts;
}

function unwrapLabel(labeldStatement) {
    var labels = [];
    while (labeldStatement.type === 'LabeledStatement') {
        labels.push(labeldStatement.label.name);
        labeldStatement = labeldStatement.body;
    }
    return {
        statement: labeldStatement,
        labels: labels
    };
}

function unwrapBlock(statement) {
    if (!statement) return [];
    if (statement.type === 'BlockStatement') {
        return statement.body.slice(0);
    } else {
        return [statement];
    }
}

function transform(part, nameContext) {
    if (part.nodes.length === 0) {
        return [part];
    }
    var node = part.nodes[0];
    var newNodes = [];
    var labels;

    var temp = unwrapLabel(node);
    node = temp.statement;
    labels = temp.labels;

    function updateContexts(parts, fromEntry, fromExit, toEntry, toExit) {
        parts.forEach(function (i) {
            i.loopContexts.forEach(function (i) {
                i.updateEntry(fromEntry, toEntry);
                i.updateExit(fromExit, toExit);
            });
        });
    }

    switch (node.type) {
        case 'ForStatement':
            newNodes.push(new Part([node.init]));
            newNodes.push(new Part([]));

            var body = unwrapBlock(node.body).concat([{
                "type": "ExpressionStatement",
                "expression": node.update
            }]);

            for (var i = 0; i < body.length; i++) {
                var newPart = new Part([body[i]]);
                newPart.addPrev(newNodes[newNodes.length - 1]);
                newPart.prevs.forEach(function (i) {
                    i.setNext(newPart);
                });
                newNodes.push(newPart);
            }
            newNodes[0].addPrev(part.prevs[0]);
            newNodes[0].setNext(newNodes[1]);

            newNodes[1].addPrev(newNodes[0]);
            newNodes[1].addPrev(newNodes[newNodes.length - 1]);
            newNodes[1].setNext(newNodes[2]);
            newNodes[1].setCondition(node.test);
            newNodes[1].setAlt(part.next);

            // newNodes[2].addPrev(newNodes[1]);
            newNodes[newNodes.length - 1].setNext(newNodes[1]);

            part.setPrevsOfNext([newNodes[1] /*, newNodes[newNodes.length - 1]*/]);
            part.setNextOfPrev(newNodes[0]);

            var loopContext = new LoopContext(newNodes[1], part.next, labels);

            newNodes.forEach(function (i) {
                i.addLoopContext(part.loopContexts);
                i.addLoopContext(loopContext);
            });

            updateContexts(newNodes, part, part, newNodes[0], newNodes[0]);

            return newNodes;
        case 'IfStatement':
            var nexts = unwrapBlock(node.consequent);
            var alts = unwrapBlock(node.alternate);
            var condition = node.test;

            var nextParts = nexts.map(function (i) {
                return new Part([i]);
            });
            if (nextParts.length === 0) {
                nextParts.push(new Part([]));
            }
            Part.chain(nextParts);

            var altParts = alts.map(function (i) {
                return new Part([i]);
            });
            if (altParts.length === 0) {
                altParts.push(new Part([]));
            }
            Part.chain(altParts);

            var conditionPart = new Part([], part.prevs.slice(0), nextParts[0], condition, altParts[0]);
            nextParts[nextParts.length - 1].setNext(part.next);
            altParts[altParts.length - 1].setNext(part.next);

            nextParts[0].addPrev(conditionPart);
            altParts[0].addPrev(conditionPart);

            part.setPrevsOfNext([nextParts[nextParts.length - 1], altParts[altParts.length - 1]]);
            part.setNextOfPrev(conditionPart);

            newNodes = [conditionPart].concat(nextParts).concat(altParts);

            newNodes.forEach(function (i) {
                i.addLoopContext(part.loopContexts);
            });
            updateContexts(newNodes, null, part, null, newNodes[0]);
            return newNodes;
        case 'WhileStatement':
            var body = unwrapBlock(node.body);

            var entryPart = new Part([]);
            entryPart.setCondition(node.test);

            var bodyParts = body.map(function (i) {
                return new Part([i]);
            });
            if (bodyParts.length === 0) {
                bodyParts.push(new Part([]));
            }
            Part.chain(bodyParts);

            entryPart.addPrev(part.prevs);
            entryPart.addPrev(bodyParts[bodyParts.length - 1]);
            entryPart.setNext(bodyParts[0]);
            entryPart.setCondition(node.test);
            entryPart.setAlt(part.next);

            bodyParts[0].addPrev(entryPart);
            bodyParts[bodyParts.length - 1].setNext(entryPart);

            part.setPrevsOfNext([entryPart]);
            part.setNextOfPrev(entryPart);

            var newNodes = [entryPart].concat(bodyParts);

            var loopContext = new LoopContext(newNodes[1], part.next, labels);

            newNodes.forEach(function (i) {
                i.addLoopContext(part.loopContexts);
                i.addLoopContext(loopContext);
            });
            updateContexts(newNodes, part, part, newNodes[0], newNodes[0]);

            return newNodes;
        case 'SwitchStatement':
            var tempIdentifier = nameContext.get('__switch');
            var discriminant = node.discriminant;
            var entryPart = new Part([
            /*t.expressionStatement(t.assignmentExpression('=', tempIdentifier, discriminant))*/

            t.variableDeclaration('var', [t.VariableDeclarator(tempIdentifier, discriminant)])]);
            var exitPart = new Part([t.expressionStatement(t.assignmentExpression('=', tempIdentifier, t.nullLiteral()))]);

            var cases = node.cases.map(function (i) {
                var casePart = new Part([]);
                if (i.test) {
                    casePart.setCondition(t.BinaryExpression('===', tempIdentifier, i.test));
                }
                var caseBodys = i.consequent.map(function (i) {
                    return new Part([i]);
                });
                if (caseBodys.length === 0) {
                    caseBodys.push(new Part([]));
                }
                Part.chain(caseBodys);
                casePart.setNext(caseBodys[0]);
                caseBodys[0].addPrev(casePart);

                return {
                    casePart: casePart,
                    caseBodys: caseBodys
                };
            });

            if (cases.length === 0) {
                // remove the whole switch, since nothing inside;
                var newPart = new Part([{
                    "type": "ExpressionStatement",
                    "expression": discriminant
                }]);
                part.setNextOfPrev(newPart);
                part.setPrevsOfNext(newPart);
                return [part];
            }

            entryPart.addPrev(part.prevs);
            entryPart.setNext(cases[0].casePart);

            for (var i = 0; i < cases.length - 1; i++) {
                if (cases[i].casePart.condition) {
                    cases[i].casePart.setAlt(cases[i + 1].casePart);
                }
                cases[i].caseBodys[cases[i].caseBodys.length - 1].setNext(cases[i + 1].caseBodys[0]);
                cases[i + 1].caseBodys[0].addPrev(cases[i].caseBodys[cases[i].caseBodys.length - 1]);
            }
            var lastCase = cases[cases.length - 1];
            lastCase.casePart.setNext(lastCase.caseBodys[0]);
            if (lastCase.casePart.condition) {
                lastCase.casePart.setAlt(exitPart);
            }
            lastCase.caseBodys[lastCase.caseBodys.length - 1].setNext(exitPart);
            exitPart.setNext(part.next);

            part.setNextOfPrev(entryPart);
            part.setPrevsOfNext(exitPart);

            newNodes = [entryPart].concat(cases.map(function (i) {
                return [i.casePart].concat(i.caseBodys);
            }).reduce(function (prev, next) {
                return prev.concat(next);
            }, [])).concat([exitPart]);

            var loopContext = new LoopContext(null, part.next, labels);

            newNodes.forEach(function (i) {
                i.addLoopContext(part.loopContexts);
                i.addLoopContext(loopContext);
            });

            // console.log('nodes ' + newNodes.length)
            // cases.forEach(function (i) {
            //     console.log('case: ' + i . caseBodys.length);
            // })

            // newNodes.forEach(function (i) {console.log(i === part)})
            return newNodes;
        default:
            return [part];
    }
}

function makeNewTree(parts, flowIdentifier, shuffle) {
    var mainBody = [t.variableDeclaration('var', [t.VariableDeclarator(flowIdentifier, t.numericLiteral(1))]), t.WhileStatement(flowIdentifier, t.BlockStatement([t.SwitchStatement(flowIdentifier, [])]))];

    if (parts.length === 0) {
        return [];
    }

    var entry = parts[0];

    if (shuffle) {
        for (var i = parts.length - 1; i > 0; i--) {
            var temp = null;
            var swapeTo = Math.floor(Math.random() * (i + 1));
            temp = parts[swapeTo];
            parts[swapeTo] = parts[i];
            parts[i] = temp;
        }
    }

    // label the parts with number
    parts.forEach(function (i, index) {
        i.label = index + 1;
    });

    mainBody[0].declarations[0].init.value = entry.label;
    mainBody[0].declarations[0].init.raw = '' + entry.label;

    // create bodys
    parts.forEach(function (part, index) {
        var next, condition, alt, jump, body;
        if (part.next && parts.indexOf(part.next) < 0) {

            console.log(parts.indexOf(part.next));
        }

        if (part.condition) {
            next = part.next ? part.next.label : 0;
            alt = part.alt ? part.alt.label : 0;
            condition = part.condition;
            jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next, condition, alt);
            part.body = part.nodes.concat([jump]);
        } else {
            next = part.next ? part.next.label : 0;
            jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next);
            part.body = part.nodes.concat([jump]);
        }
    });

    // create cases and insert into the switch statement
    parts.forEach(function (part) {
        part.case = makeCase(part.body, part.label);
        mainBody[1].body.body[0].cases.push(part.case);
    });
    return mainBody;
}

function createAssignmentExpressionStatement(name, expression) {
    return t.ExpressionStatement(t.assignmentExpression('=', name, expression));
}

function createLiteralAssignmentExpressionStatement(name, val, condition, alt) {
    if (!condition) {
        return createAssignmentExpressionStatement(name, t.numericLiteral(val));
    } else {
        return createAssignmentExpressionStatement(name, t.conditionalExpression(condition, t.numericLiteral(val), t.numericLiteral(alt)));
    }
}

function makeCase(body, test) {
    return t.switchCase(t.numericLiteral(test), body.concat(t.breakStatement()));
}
