const Part = require("../part");
const utils = require("./utils");
module.exports = function (t, parts) {
  var dirty = false;
  
  for (var index = parts.length - 1; index >= 0; index--) {
    var part = parts[index];
    var next = parts[index + 1] || null;
    var prev = parts[index - 1] || null;
    
    var temp = null;
    if (part.type === 'general' && t.isDoWhileStatement(part.nodes[0])) {
      Part.unlink(prev, part);
      Part.unlink(part, next);
      
      var node = part.nodes[0];
      var condition = node.test;
      var body = node.body.body.slice(0);
      
      var newParts = body.map(function (node) {
        return new Part('general', [node]);
      })
      
      newParts.forEach(function (p, i) {
        if (i === 0) return;
        Part.link(newParts[i - 1], p);
      })
      
      var conditionNode = new Part('general', [])
      
      Part.link(prev, newParts[0]);
      
      
      Part.link(newParts[newParts.length - 1], conditionNode);
      
      Part.link(conditionNode, next);
      conditionNode.setCondition(condition);
      Part.linkAlt(conditionNode, newParts[0]);
      
      parts.splice.apply(parts, [index, 1].concat(newParts).concat([conditionNode]));
      dirty = true;
    }
  }
  return dirty;
}