var esprima = require('esprima');
var escodegen = require('escodegen');
var babel = require('babel-core');

function gen(code) {
    code = babel
    .transform(code, {
        presets: ['es2015']
    })
    .code;
    
    
    var ast = esprima.parse(code);
    var parts = split(ast.body);
    var newAst = {
        "type": "Program",
        "body": makeNewTree(parts),
        "sourceType": "script"
    }
    return {
        parts: parts,
        ast: ast,
        newAst: newAst,
        test: escodegen.generate(ast),
        newText: escodegen.generate(newAst)
    };
}

function split(nodes) {
    var parts = [];
    parts = nodes.slice(0);
    parts = parts.map(function (i) {
        return new Part([i]);
    })
    for (var i = 0; i < parts.length; i++) {
        if (i !== 0) {
            parts[i].prevs.push(parts[i - 1]);
        }
        if (i !== parts.length - 1) {
            parts[i].next = parts[i + 1];
        }
    }
    var prevLength = -1;
    while (prevLength !== parts.length) {
        prevLength = parts.length;
        for (var i = parts.length - 1; i >= 0; i--) {
            [].splice.apply(parts, [i, 1].concat(transform(parts[i])))
        }
    }
    collapesParts(parts)
    parts.forEach(function(i) {
        console.log(JSON.stringify(i.nodes, 0, 4))
    })
    
    return parts;
}

function collapesParts(parts) {
    var blackedTypes = ['IfStatement', 'ForStatement', 'WhileStatement', 'DoWhileStatement']
    for (var i = parts.length - 1; i >= 1; i--) {
        // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
        if (
            parts[i - 1].condition == null &&
            parts[i].condition == null &&
            parts[i].prevs.length === 1 &&
            (parts[i].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i].nodes[0].type)) &&
            (parts[i - 1].nodes.length === 0 || 0 > blackedTypes.indexOf(parts[i - 1].nodes[0].type))
        ) {
            // console.log(parts[i].nodes[0].type, parts[i - 1].nodes[0].type)
            parts[i].concatPrev(parts[i - 1]);
            parts.splice(i - 1, 1);
        }
    }
}

function transform(part) {
    if (part.nodes.length === 0) {
        return [part];
    }
    var node = part.nodes[0];
    var newNodes = [];
    switch (node.type) {
        case 'ForStatement':
            newNodes.push(new Part([node.init]))
            newNodes.push(new Part([]))
            
            if (node.body.type === 'BlockStatement') {
                var body = node.body.body.concat([{
                    "type": "ExpressionStatement",
                    "expression": node.update
                }])
            } else {
                var body = [
                    node.body,
                    {
                        "type": "ExpressionStatement",
                        "expression": node.update
                    }
                ];
            }
            
            for (var i = 0; i < body.length; i++) {
                var newPart = new Part([body[i]]);
                newPart.addPrev(newNodes[newNodes.length - 1]);
                newPart.prevs.forEach(function (i) {
                    i.setNext(newPart)
                })
                newNodes.push(newPart);
            }
            newNodes[0].addPrev(part.prevs[0]);
            newNodes[0].setNext(newNodes[1]);
            
            newNodes[1].addPrev(newNodes[0]);
            newNodes[1].setNext(newNodes[2]);
            newNodes[1].setCondition(node.test);
            newNodes[1].setAlt(part.next);
            
            // newNodes[2].addPrev(newNodes[1]);
            newNodes[newNodes.length - 1].setNext(newNodes[1]);
            
            part.setPrevsOfNext([newNodes[1], newNodes[newNodes.length - 1]]);
            part.setNextOfPrev(newNodes[0])
            
            return newNodes;
        default:
            return [part];
    }
}

function makeNewTree(parts) {
    var pointerName = '$_';
    var mainBody = [{
            "type": "VariableDeclaration",
            "declarations": [
                {
                    "type": "VariableDeclarator",
                    "id": {
                        "type": "Identifier",
                        "name": pointerName
                    },
                    "init": {
                        "type": "Literal",
                        "value": 1,
                        "raw": "1"
                    }
                }
            ],
            "kind": "var"
        },
        {
            "type": "WhileStatement",
            "test": {
                "type": "Identifier",
                "name": "$_"
            },
            "body": {
                "type": "BlockStatement",
                "body": [
                    {
                        "type": "SwitchStatement",
                        "discriminant": {
                            "type": "Identifier",
                            "name": pointerName
                        },
                        "cases": []
                    }
                ]
            }
    }]
    
    // label the parts with number
    parts.forEach(function (i, index) {
        i.label = index + 1;
    })
    
    // create bodys
    parts.forEach(function (part) {
        var next, condition, alt, jump, body;
        if (part.condition) {
            next = part.next ? part.next.label : 0;
            alt = part.alt ? part.alt.label : 0;
            condition = part.condition
            jump = createAssignmentExpressionStatement(pointerName, next, condition, alt);
            part.body = part.nodes.concat([jump])
        } else {
            next = part.next ? part.next.label : 0;
            jump = createAssignmentExpressionStatement(pointerName, next);
            part.body = part.nodes.concat([jump])
        }
    })
    
    // create cases and insert into the switch statement
    parts.forEach(function (part) {
        part.case = makeCase(part.body, part.label);
        mainBody[1].body.body[0].cases.push(part.case)
    })
    return mainBody;
}

function makeCase(body, test) {
    return {
        "type": "SwitchCase",
        "test": {
            "type": "Literal",
            "value": test,
            "raw": test.toString()
        },
        "consequent": body.concat([
            {
                "type": "BreakStatement",
                "label": null
            }
        ])
    }
}

function createAssignmentExpressionStatement(name, val, condition, alt) {
    if (!condition) {
        return {
            "type": "ExpressionStatement",
            "expression": {
                "type": "AssignmentExpression",
                "operator": "=",
                "left": {
                    "type": "Identifier",
                    "name": name
                },
                "right": {
                    "type": "Literal",
                    "value": val,
                    "raw": val.toString()
                }
            }
        }
    } else {
        return {
            "type": "ExpressionStatement",
            "expression": {
                "type": "AssignmentExpression",
                "operator": "=",
                "left": {
                    "type": "Identifier",
                    "name": name
                },
                "right": {
                    "type": "ConditionalExpression",
                    "test": condition,
                    "consequent": {
                        "type": "Literal",
                        "value": val,
                        "raw": val.toString()
                    },
                    "alternate": {
                        "type": "Literal",
                        "value": alt,
                        "raw": alt.toString()
                    }
                }
            }
        }
    }
}

function Part(nodes, prevs, next, condition, alt) {
    this.nodes = nodes.slice(0);
    this.prevs = prevs || [];
    this.next = next || null;;
    this.condition = condition || null;
    this.alt = alt || null;
    this.label = null;
}
Part.prototype.concatPrev = function(part) {
    var self = this;
    if (
        this.prevs.length !== 1 ||
        this.prevs[0] !== part ||
        part.next !== this ||
        part.condition !== null
    ) {
        throw new Error('cannot merge part');
    }
    this.prevs = part.prevs.slice(0);
    this.nodes = part.nodes.concat(this.nodes);
    this.prevs.forEach(function(i) {
        if (i.next === part) {
            i.next = self;
        }
        if (i.alt === part) {
            i.alt = self;
        }
    })
}
Part.prototype.setNext = function(part) {
    this.next = part;
}
Part.prototype.setAlt = function(part) {
    this.alt = part;
}
Part.prototype.setCondition = function(expression) {
    this.condition = expression;
}
Part.prototype.addPrev = function(part) {
    this.prevs.push(part);
}
Part.prototype.replacePrev = function(from, part) {
    if (0 <= this.prevs.indexOf(from)) {
        this.prevs.splice(this.prevs.indexOf(from), 1, part);
    }
}
Part.prototype.setPrevsOfNext = function(part) {
    if (!Array.isArray(part)) part = [part]
    if (this.next) {
        if (0 <= this.next.prevs.indexOf(this)) {
            [].splice.apply(this.next.prevs, [this.next.prevs.indexOf(this), 1].concat(part))
        }
    }
}
Part.prototype.setNextOfPrev = function(part) {
    var self = this;
    this.prevs.forEach(function(i) {
        if (i.next === self) {
            i.next = part
        }
        if (i.alt === self) {
            i.alt = part
        }
    })
}
module.exports = gen;