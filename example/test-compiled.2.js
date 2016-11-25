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
    var _5 = 7;

    while (_5) {
        switch (_5) {
            case 1:
                _5 = i < parts.length ? 12 : 3;
                break;

            case 2:

                var newTree = t.BlockStatement(makeNewTree(parts, nameContext.get('_'), true));

                path.get('body').replaceWith(newTree);
                _5 = 0;
                break;

            case 3:

                collapesParts(parts);

                // for too mini function
                _5 = parts.length <= 3 ? 5 : 6;
                break;

            case 4:
                [].splice.apply(parts, [i, 1].concat(transform(parts[i], nameContext)));
                i--;
                _5 = 10;
                break;

            case 5:
                return;
                _5 = 2;
                break;

            case 6:
                _5 = 2;
                break;

            case 7:
                var name = path.scope.generateUidIdentifier("_");
                var statements = path.node.body.body;
                var parts = split(statements);
                var nameContext = new NameContext(path);

                var prevLength = -1;
                _5 = 9;
                break;

            case 8:
                fixBreakAndContinueStatement(parts);

                var i = 0;_5 = 1;
                break;

            case 9:
                _5 = prevLength !== parts.length ? 11 : 8;
                break;

            case 10:
                _5 = i >= 0 ? 4 : 9;
                break;

            case 11:
                prevLength = parts.length;
                var i = parts.length - 1;_5 = 10;
                break;

            case 12:
                parts[i].originalIndex = i;
                i++;
                _5 = 1;
                break;
        }
    }
}
function fixBreakAndContinueStatement(parts) {
    var _7 = 8;

    while (_7) {
        switch (_7) {
            case 1:
                targetContext = loopContexts[loopContexts.length - 1];
                _7 = 9;
                break;

            case 2:
                var label = part.nodes[0].label;
                var target;
                _7 = label ? 4 : 1;
                break;

            case 3:
                _7 = 5;
                break;

            case 4:
                targetContext = loopContexts.filter(function (context) {
                    return 0 <= context.labels.indexOf(label);
                })[0];
                _7 = 9;
                break;

            case 5:
                i++;
                _7 = 11;
                break;

            case 6:
                target = targetContext.exit;
                _7 = 12;
                break;

            case 7:
                target = targetContext.entry;
                _7 = 12;
                break;

            case 8:
                var part, loopContexts, targetContext;
                var i = 0;_7 = 11;
                break;

            case 9:
                _7 = part.nodes[0].type === 'BreakStatement' ? 6 : 7;
                break;

            case 10:
                part = parts[i];
                loopContexts = part.loopContexts;

                _7 = part.nodes.length > 0 && (part.nodes[0].type === 'BreakStatement' || parts[i].nodes[0].type === 'ContinueStatement') ? 2 : 3;
                break;

            case 11:
                _7 = i < parts.length ? 10 : 0;
                break;

            case 12:
                // console.log('jump to ' + parts.indexOf(target))
                part.nodes = [];
                part.setPrevsOfNext(null);
                part.setNext(target);
                _7 = 5;
                break;
        }
    }
}

function collapesParts(parts) {
    var _10 = 2;

    while (_10) {
        switch (_10) {
            case 1:
                i--;
                _10 = 5;
                break;

            case 2:
                var blackedTypes = ['IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement', 'LabeledStatement', 'SwitchStatement'];
                var i = parts.length - 1;_10 = 5;
                break;

            case 3:
                // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
                parts[i].concatPrev(parts[i - 1]);
                parts.splice(i - 1, 1);

                parts.forEach(function (i, index) {
                    var _12 = 3;

                    while (_12) {
                        switch (_12) {
                            case 1:
                                _12 = 0;
                                break;

                            case 2:
                                console.error(i, index);
                                _12 = 0;
                                break;

                            case 3:
                                _12 = i.next != null ? 4 : 1;
                                break;

                            case 4:
                                _12 = parts.indexOf(i.next) < 0 ? 2 : 5;
                                break;

                            case 5:
                                _12 = 0;
                                break;
                        }
                    }
                });
                _10 = 1;
                break;

            case 4:
                _10 = parts[i - 1].condition == null && parts[i - 1].next === parts[i] &&
                // parts[i].condition == null &&
                parts[i].prevs.length === 1 && parts[i].prevs[0] === parts[i - 1] && (parts[i].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i].nodes[0].type)) && (parts[i - 1].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i - 1].nodes[0].type)) ? 3 : 6;
                break;

            case 5:
                _10 = i >= 1 ? 4 : 0;
                break;

            case 6:
                _10 = 1;
                break;
        }
    }
}
function split(nodes) {
    var _14 = 1;

    while (_14) {
        switch (_14) {
            case 1:
                var parts = [];
                parts = nodes.slice(0);
                parts = parts.map(function (i) {
                    return new Part([i]);
                });
                var i = 0;_14 = 3;
                break;

            case 2:
                parts[i].next = parts[i + 1];
                _14 = 9;
                break;

            case 3:
                _14 = i < parts.length ? 8 : 4;
                break;

            case 4:

                return parts;
                _14 = 0;
                break;

            case 5:
                _14 = 9;
                break;

            case 6:
                _14 = 10;
                break;

            case 7:
                parts[i].prevs.push(parts[i - 1]);
                _14 = 10;
                break;

            case 8:
                _14 = i !== 0 ? 7 : 6;
                break;

            case 9:
                i++;
                _14 = 3;
                break;

            case 10:
                _14 = i !== parts.length - 1 ? 2 : 5;
                break;
        }
    }
}

function unwrapLabel(labeldStatement) {
    var _17 = 1;

    while (_17) {
        switch (_17) {
            case 1:
                var labels = [];
                _17 = 4;
                break;

            case 2:
                labels.push(labeldStatement.label.name);
                labeldStatement = labeldStatement.body;
                _17 = 4;
                break;

            case 3:
                return {
                    statement: labeldStatement,
                    labels: labels
                };
                _17 = 0;
                break;

            case 4:
                _17 = labeldStatement.type === 'LabeledStatement' ? 2 : 3;
                break;
        }
    }
}

function unwrapBlock(statement) {
    var _19 = 5;

    while (_19) {
        switch (_19) {
            case 1:
                _19 = statement.type === 'BlockStatement' ? 4 : 6;
                break;

            case 2:
                return [];
                _19 = 1;
                break;

            case 3:
                _19 = 1;
                break;

            case 4:
                return statement.body.slice(0);
                _19 = 0;
                break;

            case 5:
                _19 = !statement ? 2 : 3;
                break;

            case 6:
                return [statement];
                _19 = 0;
                break;
        }
    }
}

function transform(part, nameContext) {
    var _21 = 16;

    while (_21) {
        switch (_21) {
            case 1:
                _21 = 33;
                break;

            case 2:
                newNodes.push(new Part([node.init]));
                newNodes.push(new Part([]));

                var body = unwrapBlock(node.body).concat([{
                    "type": "ExpressionStatement",
                    "expression": node.update
                }]);

                var i = 0;_21 = 37;
                break;

            case 3:
                _21 = 39;
                break;

            case 4:
                altParts.push(new Part([]));
                _21 = 33;
                break;

            case 5:
                _21 = 22;
                break;

            case 6:
                _21 = 13;
                break;

            case 7:
                _21 = _switch === 'IfStatement' ? 23 : 25;
                break;

            case 8:
                _21 = 9;
                break;

            case 9:
                _switch = null;
                _21 = 0;
                break;

            case 10:
                _21 = _switch === 'SwitchStatement' ? 34 : 8;
                break;

            case 11:
                _21 = cases[i].casePart.condition ? 20 : 18;
                break;

            case 12:
                cases[i].caseBodys[cases[i].caseBodys.length - 1].setNext(cases[i + 1].caseBodys[0]);
                cases[i + 1].caseBodys[0].addPrev(cases[i].caseBodys[cases[i].caseBodys.length - 1]);
                i++;
                _21 = 35;
                break;

            case 13:

                entryPart.addPrev(part.prevs);
                entryPart.setNext(cases[0].casePart);

                var i = 0;_21 = 35;
                break;

            case 14:
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
                _21 = 23;
                break;

            case 15:
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
                _21 = 21;
                break;

            case 16:
                _21 = part.nodes.length === 0 ? 28 : 3;
                break;

            case 17:
                _21 = _switch === 'ForStatement' ? 2 : 7;
                break;

            case 18:
                _21 = 12;
                break;

            case 19:
                _21 = 15;
                break;

            case 20:
                cases[i].casePart.setAlt(cases[i + 1].casePart);
                _21 = 12;
                break;

            case 21:
                return [part];
                _21 = 9;
                break;

            case 22:
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
                _21 = 34;
                break;

            case 23:
                var nexts = unwrapBlock(node.consequent);
                var alts = unwrapBlock(node.alternate);
                var condition = node.test;

                var nextParts = nexts.map(function (i) {
                    return new Part([i]);
                });
                _21 = nextParts.length === 0 ? 30 : 40;
                break;

            case 24:
                lastCase.casePart.setAlt(exitPart);
                _21 = 15;
                break;

            case 25:
                _21 = _switch === 'WhileStatement' ? 38 : 10;
                break;

            case 26:
                bodyParts.push(new Part([]));
                _21 = 22;
                break;

            case 27:
                Part.chain(nextParts);

                var altParts = alts.map(function (i) {
                    return new Part([i]);
                });
                _21 = altParts.length === 0 ? 4 : 1;
                break;

            case 28:
                return [part];
                _21 = 39;
                break;

            case 29:
                // remove the whole switch, since nothing inside;
                var newPart = new Part([{
                    "type": "ExpressionStatement",
                    "expression": discriminant
                }]);
                part.setNextOfPrev(newPart);
                part.setPrevsOfNext(newPart);
                return [part];
                _21 = 13;
                break;

            case 30:
                nextParts.push(new Part([]));
                _21 = 27;
                break;

            case 31:
                var lastCase = cases[cases.length - 1];
                lastCase.casePart.setNext(exitPart);
                _21 = lastCase.casePart.condition ? 24 : 19;
                break;

            case 32:
                var _switch = node.type;
                _21 = 17;
                break;

            case 33:
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
                _21 = 38;
                break;

            case 34:
                var tempIdentifier = nameContext.get('__switch');
                var discriminant = node.discriminant;
                var entryPart = new Part([
                /*t.expressionStatement(t.assignmentExpression('=', tempIdentifier, discriminant))*/

                t.variableDeclaration('var', [t.VariableDeclarator(tempIdentifier, discriminant)])]);
                var exitPart = new Part([t.expressionStatement(t.assignmentExpression('=', tempIdentifier, t.nullLiteral()))]);

                var cases = node.cases.map(function (i) {
                    var _31 = 2;

                    while (_31) {
                        switch (_31) {
                            case 1:
                                casePart.setCondition(t.BinaryExpression('===', tempIdentifier, i.test));
                                _31 = 3;
                                break;

                            case 2:
                                var casePart = new Part([]);
                                _31 = i.test ? 1 : 4;
                                break;

                            case 3:
                                var caseBodys = i.consequent.map(function (i) {
                                    return new Part([i]);
                                });
                                _31 = caseBodys.length === 0 ? 7 : 6;
                                break;

                            case 4:
                                _31 = 3;
                                break;

                            case 5:
                                Part.chain(caseBodys);
                                casePart.setNext(caseBodys[0]);
                                caseBodys[0].addPrev(casePart);

                                return {
                                    casePart: casePart,
                                    caseBodys: caseBodys
                                };
                                _31 = 0;
                                break;

                            case 6:
                                _31 = 5;
                                break;

                            case 7:
                                caseBodys.push(new Part([]));
                                _31 = 5;
                                break;
                        }
                    }
                });

                _21 = cases.length === 0 ? 29 : 6;
                break;

            case 35:
                _21 = i < cases.length - 1 ? 11 : 31;
                break;

            case 36:
                var newPart = new Part([body[i]]);
                newPart.addPrev(newNodes[newNodes.length - 1]);
                newPart.prevs.forEach(function (i) {
                    i.setNext(newPart);
                });
                newNodes.push(newPart);
                i++;
                _21 = 37;
                break;

            case 37:
                _21 = i < body.length ? 36 : 14;
                break;

            case 38:
                var body = unwrapBlock(node.body);

                var entryPart = new Part([]);
                entryPart.setCondition(node.test);

                var bodyParts = body.map(function (i) {
                    return new Part([i]);
                });
                _21 = bodyParts.length === 0 ? 26 : 5;
                break;

            case 39:
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

                _21 = 32;
                break;

            case 40:
                _21 = 27;
                break;
        }
    }
}

function makeNewTree(parts, flowIdentifier, shuffle) {
    var _39 = 7;

    while (_39) {
        switch (_39) {
            case 1:
                var temp = null;
                var swapeTo = Math.floor(Math.random() * (i + 1));
                temp = parts[swapeTo];
                parts[swapeTo] = parts[i];
                parts[i] = temp;
                i--;
                _39 = 8;
                break;

            case 2:
                return [];
                _39 = 4;
                break;

            case 3:
                _39 = 6;
                break;

            case 4:

                var entry = parts[0];

                _39 = shuffle ? 9 : 3;
                break;

            case 5:
                _39 = 4;
                break;

            case 6:

                // label the parts with number
                parts.forEach(function (i, index) {
                    i.label = index + 1;
                });

                mainBody[0].declarations[0].init.value = entry.label;
                mainBody[0].declarations[0].init.raw = '' + entry.label;

                // create bodys
                parts.forEach(function (part, index) {
                    var _42 = 4;

                    while (_42) {
                        switch (_42) {
                            case 1:
                                next = part.next ? part.next.label : 0;
                                jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next);
                                part.body = part.nodes.concat([jump]);
                                _42 = 0;
                                break;

                            case 2:

                                console.log(parts.indexOf(part.next));
                                _42 = 5;
                                break;

                            case 3:
                                _42 = 5;
                                break;

                            case 4:
                                var next, condition, alt, jump, body;
                                _42 = part.next && parts.indexOf(part.next) < 0 ? 2 : 3;
                                break;

                            case 5:
                                _42 = part.condition ? 6 : 1;
                                break;

                            case 6:
                                next = part.next ? part.next.label : 0;
                                alt = part.alt ? part.alt.label : 0;
                                condition = part.condition;
                                jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next, condition, alt);
                                part.body = part.nodes.concat([jump]);
                                _42 = 0;
                                break;
                        }
                    }
                });

                // create cases and insert into the switch statement
                parts.forEach(function (part) {
                    part.case = makeCase(part.body, part.label);
                    mainBody[1].body.body[0].cases.push(part.case);
                });
                return mainBody;
                _39 = 0;
                break;

            case 7:
                var mainBody = [t.variableDeclaration('var', [t.VariableDeclarator(flowIdentifier, t.numericLiteral(1))]), t.WhileStatement(flowIdentifier, t.BlockStatement([t.SwitchStatement(flowIdentifier, [])]))];

                _39 = parts.length === 0 ? 2 : 5;
                break;

            case 8:
                _39 = i > 0 ? 1 : 6;
                break;

            case 9:
                var i = parts.length - 1;_39 = 8;
                break;
        }
    }
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
