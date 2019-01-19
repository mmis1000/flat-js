// implented
const Part = require("../part");
const utils = require("./utils");
const LoopContext = require("../loop-context")
module.exports = function (t, parts) {
  var dirty = false;
  
  for (var index = parts.length - 1; index >= 0; index--) {
    var part = parts[index];
    var next = parts[index].next || null
    var alt = parts[index].alt || null;
    var prevs = parts.prevs || null;
    
    var contexts = [];
    
    if (part.type === 'general') {
      while (t.isLabeledStatement(part.nodes[0])) {
        dirty = true;
        var node = part.nodes[0];
        var context = new LoopContext(node.label.name, part.next)
        part.addLoopContext(context)
        part.nodes[0] = part.nodes[0].body
      }
    }
  }
  return dirty;
}