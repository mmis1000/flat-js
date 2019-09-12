const Part = require("../part");
const utils = require("./utils");
module.exports = function(t, parts) {
  var dirty = false;

  for (var index = parts.length - 1; index >= 0; index--) {
    var part = parts[index];
    var next = parts[index + 1] || null;
    var prev = parts[index - 1] || null;

    var temp = null;
    if (part.type === 'general' && t.isIfStatement(part.nodes[0])) {
      Part.unlink(prev, part);
      Part.unlink(part, next);

      var node = part.nodes[0];
      var condition = node.test;
      var consequent = node.consequent.body.slice(0);
      var alternate = node.alternate ? node.alternate.body.slice(0) : null;

      var newConsequentParts = consequent.map(function(node) {
        return new Part('general', [node]);
      })

      var newAlternateParts = alternate ? alternate.map(function(node) {
        return new Part('general', [node]);
      }) : null;


      newConsequentParts.forEach(function(p, i) {
        if (i === 0) return;
        Part.link(newConsequentParts[i - 1], p);
      })

      if (newAlternateParts) {
        newAlternateParts.forEach(function(p, i) {
          if (i === 0) return;
          Part.link(newAlternateParts[i - 1], p);
        })
      }

      var conditionNode = new Part('general', [])
      conditionNode.setCondition(condition);

      console.log(conditionNode)
    
      Part.link(prev, conditionNode);

      Part.link(conditionNode, newConsequentParts[0]);
      if (next) Part.link(newConsequentParts[newConsequentParts.length - 1], next);

      
      if (!newAlternateParts) {
        if (next) Part.linkAlt(conditionNode, next)
      } else {
        Part.linkAlt(conditionNode, newAlternateParts[0]);
        if (next) Part.link(newAlternateParts[newAlternateParts.length - 1], next);
      }

      parts.splice.apply(parts, [index, 1])

      if (newAlternateParts) {
        parts.splice.apply(parts, [index, 0].concat(newAlternateParts));
      }

      parts.splice.apply(parts, [index, 0].concat([conditionNode]).concat(newConsequentParts));
      dirty = true;
    }
  }
  return dirty;
}