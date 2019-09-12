/**
 * in this phase
 * we will convert all parts/nodes to ir and resolve reference to all ir sections,
 * insert labels
 * translate label to their Numuric location
 * and transform ir actions to their actul command
 */

const Part = require("../part")
const ir = require("../node-transform/ir")
const transform = require("../node-transform")

function partLabel(part) {
    this.length = 0;
    this.part = part
}

function functionLabel(label) {
    this.length = 0;
    this.label = label
}

function generateIR(partss, t) {
    // preprocess;
    partss.forEach(function (parts) {
        // remove link after return statement;
        for (var i = parts.length - 1; i >= 0; i--) {
            var part = parts[i];
            if (part.type === 'general' && (part.next || part.alt) && t.isReturnStatement(part.nodes[part.nodes.length - 1])) {
                if (part.next) Part.unlink(part, part.next);
                if (part.alt) Part.unlink(part, part.next);
            }
        }
        
        // remove all unreachable statement
        for (var touched = true; touched; touched = false) {
            for (var i = parts.length - 1; i >= 0; i--) {
                var part = parts[i];
                if (part.type === 'general' && part.prevs.length === 0) {
                    // remove a node that has no entry point;
                    if (part.next) Part.unlink(part , part.next);
                    if (part.alt) Part.unlink(part , part.alt);
                    parts.splice(i, 1);
                    touched = true;
                }
            }
        }
        
        // insert return undefined to all terminate node;
        for (var i = parts.length - 1; i >= 0; i--) {
            var part = parts[i];
            if (part.type === 'general' && !part.next && !part.alt && !t.isReturnStatement(part.nodes[part.nodes.length - 1])) {
                var newPart = new Part('general', [t.returnStatement()]);
                Part.link(part, newPart);
                parts.splice(i + 1, 0, newPart)
            }
        }
    })
    
    var IR_LIST = [];
    for (var i = 0; i < partss.length; i++) {
        var sub_IR_LIST = [];
        var parts = partss[i];
        
        for (var j = 0; j < parts.length; j++) {
            var part = parts[j];
            var irInPart = [];
            if (part.type === 'entry') {
                var node = part.info.node;
                if (node.type === 'Program') {
                    irInPart = irInPart.concat([
                        // new ir.getScope(),
                        // new ir.putUndefined(),
                        // new ir.putNumber(0),
                        new ir.putNumber(0),
                        new ir.initScope()
                    ])
                } else {
                    irInPart = irInPart
                    .concat(node.params.map(function (arg) {
                        return new ir.putString(arg.name);
                    }))
                    .concat([
                        new ir.putNumber(node.params.length),
                        new ir.initScope()
                    ])
                    
                    if (part.info.id) {
                        irInPart = irInPart.concat([
                            new ir.getScope(),
                            new ir.putString(node.id.name),
                            new ir.createFunction(node.i_index),
                            new ir.setVal(),
                            new ir.pop()
                        ])
                    }
                    
                }
                part.irs = irInPart;
            } else {
                var nodes = part.nodes;
                
                part.irs = nodes.map((node)=>{
                    if (!transform(node)[0]) {
                        console.log(node)
                        throw new Error(node)
                    }
                    return transform(node);
                }).reduce((prev, curr)=>{
                    if (curr.indexOf(null) >= 0) {
                        console.log(curr)
                        throw new Error("erro")
                    }
                    return prev.concat(curr);


                },[])
            }
            
            if (part.next && part.condition) {
                part.irs.push(...([
                    new ir.numberFromPart(part.next),
                    new ir.numberFromPart(part.alt),
                ].concat(transform(part.condition)).concat([
                    new ir.condition(),
                    new ir.jump()
                ])))
            } else if (part.next) {
                part.irs.push(...([
                    new ir.numberFromPart(part.next),
                    new ir.jump()
                ]))
            }
            

            part.irs.unshift(new partLabel(part))
            sub_IR_LIST = sub_IR_LIST.concat(part.irs)
            
            if (part.irs.indexOf(null) >= 0 || part.irs.indexOf(undefined) >= 0) {
                console.log(part)
                console.log(part.irs)
                throw new Error("erro")
            }
        }

        sub_IR_LIST.unshift(new functionLabel(parts[0].info.node._index))
        IR_LIST = IR_LIST.concat(sub_IR_LIST)
    }
    
    // Assign offsets
    let offset = 0;

    for (let ir of IR_LIST) {
        ir.offset = offset;
        offset += (ir.length == null? 1: ir.length);
    }
    // console.log(IR_LIST)
    
    function generateCommnad(list, ir, index) {
        if (ir.length === 0) {
            return []
        }
        if (!ir.toCommand) {
            return [ir.constructor.name];
        } else {
            return ir.toCommand(index, list)
        }
    }
    
    function flat(list, out = []) {
        if (list.length > 0) {
            return flat(list.slice(1), [...out, ...list[0]]);
        } else {
            return out;
        }
    }
    
    let commands = flat(IR_LIST.map(generateCommnad.bind(null, IR_LIST)))

    console.log(commands.map((item, index)=>{
        var str = ""
        var maxlength = 5

        str += index.toString()

        while (str.length < maxlength) {
            str += " "
        }

        str += JSON.stringify(item)

        return str
    }).join("\n"))

    return commands
}

module.exports = generateIR