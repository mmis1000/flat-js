function assignmentOperate() {}function binaryOperate() {}let t;
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
            FunctionDeclaration(path) {
                transformFunction(path);
            },
            FunctionExpression(path) {
                transformFunction(path);
            }
        }
    };
};

var Part = require("./lib/part");
var LoopContext = require("./lib/loop-context");
var NameContext = require("./lib/name-context");

function transformFunction(path) {
    var _5 = 1;

    while (_5) {
        switch (_5) {
            case 1:
                var _for_uid, _for_uid2, _uid, _uid40, _uid41, _uid42, _uid43, _uid44;

                let name = path.scope.generateUidIdentifier("_");
                let statements = path.node.body.body;
                let parts = split(statements);
                let nameContext = new NameContext(path);

                var prevLength = -1;
                _5 = 2;
                break;

            case 2:
                _5 = prevLength !== parts.length ? 3 : 6;
                break;

            case 3:
                prevLength = parts.length;
                var i = parts.length - 1;_for_uid = i >= 0;
                _5 = 4;
                break;

            case 4:
                _5 = _for_uid ? 5 : 2;
                break;

            case 5:
                _uid41 = transform(parts[i], nameContext);
                _uid40 = [i, 1].concat(_uid41);

                [].splice.apply(parts, _uid40);
                i--;
                _for_uid = i >= 0;
                _5 = 4;
                break;

            case 6:
                fixBreakAndContinueStatement(parts);

                var i = 0;_for_uid2 = i < parts.length;
                _5 = 7;
                break;

            case 7:
                _5 = _for_uid2 ? 8 : 9;
                break;

            case 8:
                parts[i].originalIndex = i;
                i++;
                _for_uid2 = i < parts.length;
                _5 = 7;
                break;

            case 9:

                collapesParts(parts);

                // for too mini function
                _uid = parts.length <= 3;
                _5 = _uid ? 10 : 11;
                break;

            case 10:
                return;
                _5 = 12;
                break;

            case 11:
                _5 = 12;
                break;

            case 12:
                _uid44 = nameContext.get('_');
                _uid42 = makeNewTree(parts, _uid44, false);


                let newTree = t.BlockStatement(_uid42);

                _uid43 = path.get('body');
                _uid43.replaceWith(newTree);
                _5 = 0;
                break;
        }
    }
}
function fixBreakAndContinueStatement(parts) {
    var _7 = 1;

    while (_7) {
        switch (_7) {
            case 1:
                var _for_uid3, _uid2, _uid3, _uid4, _uid5, _uid6, _uid45, _binary_uid;

                var part, loopContexts, targetContext;
                var i = 0;_for_uid3 = i < parts.length;
                _7 = 2;
                break;

            case 2:
                _7 = _for_uid3 ? 3 : 0;
                break;

            case 3:
                part = parts[i];
                loopContexts = part.loopContexts;

                _uid4 = part.nodes.length > 0;
                _7 = _uid4 ? 4 : 8;
                break;

            case 4:
                _uid5 = part.nodes[0].type === 'BreakStatement';
                _uid6 = !_uid5;
                _7 = _uid6 ? 5 : 6;
                break;

            case 5:
                _uid5 = parts[i].nodes[0].type === 'ContinueStatement';
                _7 = 7;
                break;

            case 6:
                _7 = 7;
                break;

            case 7:
                _uid4 = _uid5;
                _7 = 9;
                break;

            case 8:
                _7 = 9;
                break;

            case 9:
                _uid2 = _uid4;
                _7 = _uid2 ? 10 : 17;
                break;

            case 10:
                var label = part.nodes[0].label;
                var target;
                _7 = label ? 11 : 12;
                break;

            case 11:
                _uid45 = loopContexts.filter(function (context) {
                    var _uid46;

                    _uid46 = context.labels.indexOf(label);

                    return 0 <= _uid46;
                });

                targetContext = _uid45[0];
                _7 = 13;
                break;

            case 12:
                _binary_uid = loopContexts.length - 1;

                targetContext = loopContexts[_binary_uid];
                _7 = 13;
                break;

            case 13:
                _uid3 = part.nodes[0].type === 'BreakStatement';
                _7 = _uid3 ? 14 : 15;
                break;

            case 14:
                target = targetContext.exit;
                _7 = 16;
                break;

            case 15:
                target = targetContext.entry;
                _7 = 16;
                break;

            case 16:
                // console.log('jump to ' + parts.indexOf(target))
                part.nodes = [];
                part.setPrevsOfNext(null);
                part.setNext(target);
                _7 = 18;
                break;

            case 17:
                _7 = 18;
                break;

            case 18:
                i++;
                _for_uid3 = i < parts.length;
                _7 = 2;
                break;
        }
    }
}

function collapesParts(parts) {
    var _10 = 1;

    while (_10) {
        switch (_10) {
            case 1:
                var _for_uid4, _uid7, _uid10, _uid11, _uid12, _uid13, _uid14, _uid15, _uid16, _uid17, _uid18, _binary_uid2, _binary_uid3, _binary_uid4, _uid47, _binary_uid5, _uid48, _binary_uid6, _binary_uid7;

                var blackedTypes = ['IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement', 'LabeledStatement', 'SwitchStatement'];
                var i = parts.length - 1;_for_uid4 = i >= 1;
                _10 = 2;
                break;

            case 2:
                _10 = _for_uid4 ? 3 : 0;
                break;

            case 3:
                _binary_uid2 = i - 1;
                _uid18 = parts[_binary_uid2].condition == null;
                _10 = _uid18 ? 4 : 5;
                break;

            case 4:
                _binary_uid3 = i - 1;
                _uid18 = parts[_binary_uid3].next === parts[i];
                _10 = 6;
                break;

            case 5:
                _10 = 6;
                break;

            case 6:
                _uid17 = _uid18;
                _10 = _uid17 ? 7 : 8;
                break;

            case 7:
                _uid17 =
                // parts[i].condition == null &&
                parts[i].prevs.length === 1;
                _10 = 9;
                break;

            case 8:
                _10 = 9;
                break;

            case 9:
                _uid14 = _uid17;
                _10 = _uid14 ? 10 : 11;
                break;

            case 10:
                _binary_uid4 = i - 1;
                _uid14 = parts[i].prevs[0] === parts[_binary_uid4];
                _10 = 12;
                break;

            case 11:
                _10 = 12;
                break;

            case 12:
                _uid11 = _uid14;
                _10 = _uid11 ? 13 : 17;
                break;

            case 13:
                _uid15 = parts[i].nodes.length === 0;
                _uid16 = !_uid15;
                _10 = _uid16 ? 14 : 15;
                break;

            case 14:
                _uid47 = blackedTypes.indexOf(parts[i].nodes[0].type);
                _uid15 = 0 > _uid47;
                _10 = 16;
                break;

            case 15:
                _10 = 16;
                break;

            case 16:
                _uid11 = _uid15;
                _10 = 18;
                break;

            case 17:
                _10 = 18;
                break;

            case 18:
                _uid10 = _uid11;
                _10 = _uid10 ? 19 : 23;
                break;

            case 19:
                _binary_uid5 = i - 1;
                _uid12 = parts[_binary_uid5].nodes.length === 0;
                _uid13 = !_uid12;
                _10 = _uid13 ? 20 : 21;
                break;

            case 20:
                _binary_uid6 = i - 1;
                _uid48 = blackedTypes.indexOf(parts[_binary_uid6].nodes[0].type);
                _uid12 = 0 > _uid48;
                _10 = 22;
                break;

            case 21:
                _10 = 22;
                break;

            case 22:
                _uid10 = _uid12;
                _10 = 24;
                break;

            case 23:
                _10 = 24;
                break;

            case 24:
                _uid7 = _uid10;
                _10 = _uid7 ? 25 : 26;
                break;

            case 25:
                // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
                parts[i].concatPrev(parts[i - 1]);
                _binary_uid7 = i - 1;
                parts.splice(_binary_uid7, 1);

                parts.forEach(function (i, index) {
                    var _12 = 1;

                    while (_12) {
                        switch (_12) {
                            case 1:
                                var _uid8, _uid9, _uid49;

                                _uid8 = i.next != null;
                                _12 = _uid8 ? 2 : 5;
                                break;

                            case 2:
                                _uid49 = parts.indexOf(i.next);
                                _uid9 = _uid49 < 0;
                                _12 = _uid9 ? 3 : 4;
                                break;

                            case 3:
                                console.error(i, index);
                                _12 = 0;
                                break;

                            case 4:
                                _12 = 0;
                                break;

                            case 5:
                                _12 = 0;
                                break;
                        }
                    }
                });

                _10 = 27;
                break;

            case 26:
                _10 = 27;
                break;

            case 27:
                i--;
                _for_uid4 = i >= 1;
                _10 = 2;
                break;
        }
    }
}
function split(nodes) {
    var _14 = 1;

    while (_14) {
        switch (_14) {
            case 1:
                var _for_uid5, _uid19, _uid20, _binary_uid8, _binary_uid9;

                var parts = [];
                parts = nodes.slice(0);
                parts = parts.map(function (i) {
                    return new Part([i]);
                });
                var i = 0;_for_uid5 = i < parts.length;
                _14 = 2;
                break;

            case 2:
                _14 = _for_uid5 ? 3 : 10;
                break;

            case 3:
                _uid19 = i !== 0;
                _14 = _uid19 ? 4 : 5;
                break;

            case 4:
                parts[i].prevs.push(parts[i - 1]);
                _14 = 6;
                break;

            case 5:
                _14 = 6;
                break;

            case 6:
                _binary_uid8 = parts.length - 1;
                _uid20 = i !== _binary_uid8;
                _14 = _uid20 ? 7 : 8;
                break;

            case 7:
                _binary_uid9 = i + 1;

                parts[i].next = parts[_binary_uid9];
                _14 = 9;
                break;

            case 8:
                _14 = 9;
                break;

            case 9:
                i++;
                _for_uid5 = i < parts.length;
                _14 = 2;
                break;

            case 10:

                return parts;
                _14 = 0;
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
                _17 = 2;
                break;

            case 2:
                _17 = labeldStatement.type === 'LabeledStatement' ? 3 : 4;
                break;

            case 3:
                labels.push(labeldStatement.label.name);
                labeldStatement = labeldStatement.body;
                _17 = 2;
                break;

            case 4:
                return {
                    statement: labeldStatement,
                    labels: labels
                };
                _17 = 0;
                break;
        }
    }
}

function unwrapBlock(statement) {
    var _19 = 1;

    while (_19) {
        switch (_19) {
            case 1:
                var _uid21, _uid22;

                _uid21 = !statement;
                _19 = _uid21 ? 2 : 3;
                break;

            case 2:
                return [];
                _19 = 4;
                break;

            case 3:
                _19 = 4;
                break;

            case 4:
                _uid22 = statement.type === 'BlockStatement';
                _19 = _uid22 ? 5 : 6;
                break;

            case 5:
                return statement.body.slice(0);
                _19 = 0;
                break;

            case 6:
                return [statement];
                _19 = 0;
                break;
        }
    }
}

function transform(part, nameContext) {
    var _21 = 1;

    while (_21) {
        switch (_21) {
            case 1:
                var _for_uid6, _for_uid7, _uid23, _uid24, _uid25, _uid26, _uid29, _uid30, _uid31, _uid50, _binary_uid10, _uid51, _binary_uid11, _binary_uid12, _uid52, _binary_uid13, _binary_uid14, _binary_uid15, _binary_uid16, _binary_uid17, _binary_uid18, _binary_uid19, _binary_uid20, _uid54, _uid55, _uid56;

                _uid23 = part.nodes.length === 0;
                _21 = _uid23 ? 2 : 3;
                break;

            case 2:
                return [part];
                _21 = 4;
                break;

            case 3:
                _21 = 4;
                break;

            case 4:
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

                _21 = 5;
                break;

            case 5:
                var _switch = node.type;
                _21 = 6;
                break;

            case 6:
                _21 = _switch === 'ForStatement' ? 7 : 11;
                break;

            case 7:
                newNodes.push(new Part([node.init]));
                newNodes.push(new Part([]));

                _uid50 = unwrapBlock(node.body);
                var body = _uid50.concat([{
                    "type": "ExpressionStatement",
                    "expression": node.update
                }]);

                var i = 0;_for_uid6 = i < body.length;
                _21 = 8;
                break;

            case 8:
                _21 = _for_uid6 ? 9 : 10;
                break;

            case 9:
                var newPart = new Part([body[i]]);
                newPart.addPrev(newNodes[newNodes.length - 1]);
                newPart.prevs.forEach(function (i) {
                    i.setNext(newPart);
                });
                newNodes.push(newPart);
                i++;
                _for_uid6 = i < body.length;
                _21 = 8;
                break;

            case 10:
                newNodes[0].addPrev(part.prevs[0]);
                newNodes[0].setNext(newNodes[1]);

                newNodes[1].addPrev(newNodes[0]);
                newNodes[1].addPrev(newNodes[newNodes.length - 1]);
                newNodes[1].setNext(newNodes[2]);
                newNodes[1].setCondition(node.test);
                newNodes[1].setAlt(part.next);

                // newNodes[2].addPrev(newNodes[1]);
                _binary_uid10 = newNodes.length - 1;
                newNodes[_binary_uid10].setNext(newNodes[1]);

                part.setPrevsOfNext([newNodes[1] /*, newNodes[newNodes.length - 1]*/]);
                part.setNextOfPrev(newNodes[0]);

                var loopContext = new LoopContext(newNodes[1], part.next, labels);

                newNodes.forEach(function (i) {
                    i.addLoopContext(part.loopContexts);
                    i.addLoopContext(loopContext);
                });

                updateContexts(newNodes, part, part, newNodes[0], newNodes[0]);

                return newNodes;
                _21 = 12;
                break;

            case 11:
                _21 = _switch === 'IfStatement' ? 12 : 19;
                break;

            case 12:
                var nexts = unwrapBlock(node.consequent);
                var alts = unwrapBlock(node.alternate);
                var condition = node.test;

                var nextParts = nexts.map(function (i) {
                    return new Part([i]);
                });
                _uid24 = nextParts.length === 0;
                _21 = _uid24 ? 13 : 14;
                break;

            case 13:
                nextParts.push(new Part([]));
                _21 = 15;
                break;

            case 14:
                _21 = 15;
                break;

            case 15:
                Part.chain(nextParts);

                var altParts = alts.map(function (i) {
                    return new Part([i]);
                });
                _uid25 = altParts.length === 0;
                _21 = _uid25 ? 16 : 17;
                break;

            case 16:
                altParts.push(new Part([]));
                _21 = 18;
                break;

            case 17:
                _21 = 18;
                break;

            case 18:
                Part.chain(altParts);

                _uid51 = part.prevs.slice(0);
                var conditionPart = new Part([], _uid51, nextParts[0], condition, altParts[0]);
                _binary_uid11 = nextParts.length - 1;
                nextParts[_binary_uid11].setNext(part.next);
                _binary_uid12 = altParts.length - 1;
                altParts[_binary_uid12].setNext(part.next);

                nextParts[0].addPrev(conditionPart);
                altParts[0].addPrev(conditionPart);

                part.setPrevsOfNext([nextParts[nextParts.length - 1], altParts[altParts.length - 1]]);
                part.setNextOfPrev(conditionPart);

                _uid52 = [conditionPart].concat(nextParts);
                newNodes = _uid52.concat(altParts);

                newNodes.forEach(function (i) {
                    i.addLoopContext(part.loopContexts);
                });
                updateContexts(newNodes, null, part, null, newNodes[0]);
                return newNodes;
                _21 = 20;
                break;

            case 19:
                _21 = _switch === 'WhileStatement' ? 20 : 24;
                break;

            case 20:
                var body = unwrapBlock(node.body);

                var entryPart = new Part([]);
                entryPart.setCondition(node.test);

                var bodyParts = body.map(function (i) {
                    return new Part([i]);
                });
                _uid26 = bodyParts.length === 0;
                _21 = _uid26 ? 21 : 22;
                break;

            case 21:
                bodyParts.push(new Part([]));
                _21 = 23;
                break;

            case 22:
                _21 = 23;
                break;

            case 23:
                Part.chain(bodyParts);

                entryPart.addPrev(part.prevs);
                entryPart.addPrev(bodyParts[bodyParts.length - 1]);
                entryPart.setNext(bodyParts[0]);
                entryPart.setCondition(node.test);
                entryPart.setAlt(part.next);

                bodyParts[0].addPrev(entryPart);
                _binary_uid13 = bodyParts.length - 1;
                bodyParts[_binary_uid13].setNext(entryPart);

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
                _21 = 25;
                break;

            case 24:
                _21 = _switch === 'SwitchStatement' ? 25 : 38;
                break;

            case 25:
                var tempIdentifier = nameContext.get('__switch');
                var discriminant = node.discriminant;
                var entryPart = new Part([
                /*t.expressionStatement(t.assignmentExpression('=', tempIdentifier, discriminant))*/

                t.variableDeclaration('var', [t.VariableDeclarator(tempIdentifier, discriminant)])]);
                var exitPart = new Part([t.expressionStatement(t.assignmentExpression('=', tempIdentifier, t.nullLiteral()))]);

                var cases = node.cases.map(function (i) {
                    var _33 = 1;

                    while (_33) {
                        switch (_33) {
                            case 1:
                                var _uid27, _uid28, _uid53;

                                var casePart = new Part([]);
                                _uid27 = i.test;
                                _33 = _uid27 ? 2 : 3;
                                break;

                            case 2:
                                _uid53 = t.BinaryExpression('===', tempIdentifier, i.test);

                                casePart.setCondition(_uid53);
                                _33 = 4;
                                break;

                            case 3:
                                _33 = 4;
                                break;

                            case 4:
                                var caseBodys = i.consequent.map(function (i) {
                                    return new Part([i]);
                                });
                                _uid28 = caseBodys.length === 0;
                                _33 = _uid28 ? 5 : 6;
                                break;

                            case 5:
                                caseBodys.push(new Part([]));
                                _33 = 7;
                                break;

                            case 6:
                                _33 = 7;
                                break;

                            case 7:
                                Part.chain(caseBodys);
                                casePart.setNext(caseBodys[0]);
                                caseBodys[0].addPrev(casePart);

                                return {
                                    casePart: casePart,
                                    caseBodys: caseBodys
                                };
                                _33 = 0;
                                break;
                        }
                    }
                });

                _uid29 = cases.length === 0;
                _21 = _uid29 ? 26 : 27;
                break;

            case 26:
                // remove the whole switch, since nothing inside;
                var newPart = new Part([{
                    "type": "ExpressionStatement",
                    "expression": discriminant
                }]);
                part.setNextOfPrev(newPart);
                part.setPrevsOfNext(newPart);
                return [part];
                _21 = 28;
                break;

            case 27:
                _21 = 28;
                break;

            case 28:

                entryPart.addPrev(part.prevs);
                entryPart.setNext(cases[0].casePart);

                var i = 0;_binary_uid14 = cases.length - 1;
                _for_uid7 = i < _binary_uid14;
                _21 = 29;
                break;

            case 29:
                _21 = _for_uid7 ? 30 : 34;
                break;

            case 30:
                _uid30 = cases[i].casePart.condition;
                _21 = _uid30 ? 31 : 32;
                break;

            case 31:
                _binary_uid15 = i + 1;

                cases[i].casePart.setAlt(cases[_binary_uid15].casePart);
                _21 = 33;
                break;

            case 32:
                _21 = 33;
                break;

            case 33:
                _binary_uid16 = cases[i].caseBodys.length - 1;
                _binary_uid17 = i + 1;

                cases[i].caseBodys[_binary_uid16].setNext(cases[_binary_uid17].caseBodys[0]);
                _binary_uid18 = i + 1;
                cases[_binary_uid18].caseBodys[0].addPrev(cases[i].caseBodys[cases[i].caseBodys.length - 1]);
                i++;
                _for_uid7 = i < _binary_uid14;
                _21 = 29;
                break;

            case 34:
                _binary_uid19 = cases.length - 1;

                var lastCase = cases[_binary_uid19];
                lastCase.casePart.setNext(lastCase.caseBodys[0]);
                _uid31 = lastCase.casePart.condition;
                _21 = _uid31 ? 35 : 36;
                break;

            case 35:
                lastCase.casePart.setAlt(exitPart);
                _21 = 37;
                break;

            case 36:
                _21 = 37;
                break;

            case 37:
                _binary_uid20 = lastCase.caseBodys.length - 1;

                lastCase.caseBodys[_binary_uid20].setNext(exitPart);
                exitPart.setNext(part.next);

                part.setNextOfPrev(entryPart);
                part.setPrevsOfNext(exitPart);

                _uid56 = cases.map(function (i) {
                    return [i.casePart].concat(i.caseBodys);
                });
                _uid55 = _uid56.reduce(function (prev, next) {
                    return prev.concat(next);
                }, []);
                _uid54 = [entryPart].concat(_uid55);
                newNodes = _uid54.concat([exitPart]);

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
                _21 = 39;
                break;

            case 38:
                _21 = 39;
                break;

            case 39:
                return [part];
                _21 = 40;
                break;

            case 40:
                _switch = null;
                _21 = 0;
                break;
        }
    }
}

function makeNewTree(parts, flowIdentifier, shuffle) {
    var _39 = 1;

    while (_39) {
        switch (_39) {
            case 1:
                var _for_uid8, _uid32, _uid57, _uid58, _binary_uid21, _uid59, _binary_uid22, _uid62;

                _uid57 = t.variableDeclaration('var', [t.VariableDeclarator(flowIdentifier, t.numericLiteral(1))]);
                _uid62 = t.BlockStatement([t.SwitchStatement(flowIdentifier, [])]);
                _uid58 = t.WhileStatement(flowIdentifier, _uid62);

                var mainBody = [_uid57, _uid58];

                _uid32 = parts.length === 0;
                _39 = _uid32 ? 2 : 3;
                break;

            case 2:
                return [];
                _39 = 4;
                break;

            case 3:
                _39 = 4;
                break;

            case 4:

                var entry = parts[0];

                _39 = shuffle ? 5 : 8;
                break;

            case 5:
                var i = parts.length - 1;_for_uid8 = i > 0;
                _39 = 6;
                break;

            case 6:
                _39 = _for_uid8 ? 7 : 9;
                break;

            case 7:
                var temp = null;
                _uid59 = Math.random();
                _binary_uid22 = i + 1;
                _binary_uid21 = _uid59 * _binary_uid22;
                var swapeTo = Math.floor(_binary_uid21);
                temp = parts[swapeTo];
                parts[swapeTo] = parts[i];
                parts[i] = temp;
                i--;
                _for_uid8 = i > 0;
                _39 = 6;
                break;

            case 8:
                _39 = 9;
                break;

            case 9:

                // label the parts with number
                parts.forEach(function (i, index) {
                    i.label = index + 1;
                });

                mainBody[0].declarations[0].init.value = entry.label;
                mainBody[0].declarations[0].init.raw = '' + entry.label;

                // create bodys
                parts.forEach(function (part, index) {
                    var _42 = 1;

                    while (_42) {
                        switch (_42) {
                            case 1:
                                var _uid33, _uid34, _uid35, _uid36, _uid37, _uid38, _uid60, _uid61;

                                var next, condition, alt, jump, body;
                                _uid38 = part.next;
                                _42 = _uid38 ? 2 : 3;
                                break;

                            case 2:
                                _uid60 = parts.indexOf(part.next);
                                _uid38 = _uid60 < 0;
                                _42 = 4;
                                break;

                            case 3:
                                _42 = 4;
                                break;

                            case 4:
                                _uid33 = _uid38;
                                _42 = _uid33 ? 5 : 6;
                                break;

                            case 5:
                                _uid61 = parts.indexOf(part.next);


                                console.log(_uid61);

                                _42 = 7;
                                break;

                            case 6:
                                _42 = 7;
                                break;

                            case 7:
                                _uid34 = part.condition;
                                _42 = _uid34 ? 8 : 15;
                                break;

                            case 8:
                                _uid35 = part.next;
                                _42 = _uid35 ? 9 : 10;
                                break;

                            case 9:
                                _uid35 = part.next.label;
                                _42 = 11;
                                break;

                            case 10:
                                _uid35 = 0;
                                _42 = 11;
                                break;

                            case 11:
                                next = _uid35;
                                _uid36 = part.alt;
                                _42 = _uid36 ? 12 : 13;
                                break;

                            case 12:
                                _uid36 = part.alt.label;
                                _42 = 14;
                                break;

                            case 13:
                                _uid36 = 0;
                                _42 = 14;
                                break;

                            case 14:
                                alt = _uid36;
                                condition = part.condition;
                                jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next, condition, alt);
                                part.body = part.nodes.concat([jump]);
                                _42 = 0;
                                break;

                            case 15:
                                _uid37 = part.next;
                                _42 = _uid37 ? 16 : 17;
                                break;

                            case 16:
                                _uid37 = part.next.label;
                                _42 = 18;
                                break;

                            case 17:
                                _uid37 = 0;
                                _42 = 18;
                                break;

                            case 18:
                                next = _uid37;
                                jump = createLiteralAssignmentExpressionStatement(flowIdentifier, next);
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
        }
    }
}

function createAssignmentExpressionStatement(name, expression) {
    var _uid63;

    _uid63 = t.assignmentExpression('=', name, expression);

    return t.ExpressionStatement(_uid63);
}

function createLiteralAssignmentExpressionStatement(name, val, condition, alt) {
    var _uid39, _uid64, _uid65, _uid66, _uid67;

    _uid39 = !condition;

    if (_uid39) {
        _uid64 = t.numericLiteral(val);

        return createAssignmentExpressionStatement(name, _uid64);
    } else {
        _uid66 = t.numericLiteral(val);
        _uid67 = t.numericLiteral(alt);
        _uid65 = t.conditionalExpression(condition, _uid66, _uid67);

        return createAssignmentExpressionStatement(name, _uid65);
    }
}

function makeCase(body, test) {
    var _uid68, _uid69, _uid70;

    _uid68 = t.numericLiteral(test);
    _uid70 = t.breakStatement();
    _uid69 = body.concat(_uid70);

    return t.switchCase(_uid68, _uid69);
}
