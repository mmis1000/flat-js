// inplemented
const Part = require("../part");
const utils = require("./utils");
const LoopContext = require("../loop-context")
module.exports = function (t, parts) {
  var dirty = false;
  
  for (var index = parts.length - 1; index >= 0; index--) {
    var part = parts[index];
    var next = parts[index].next || null
    var alt = parts[index].alt || null;
    var condition = parts[index].condition || null;
    var prevs = parts[index].prevs;
    
    var temp = null;
    
    //console.log(part.nodes[0])
    if (part.type === 'general' && t.isWhileStatement(part.nodes[0])) {
      //console.log('======detectt while======')
      dirty = true;
      part.addLoopContext(new LoopContext(null, next));
      
      var node = part.nodes[0];
      
      var condition = node.test;
      var body = node.body.body
      
      
      var newParts = body.map(function (node) {
        var newPart = new Part('general', [node]);
        newPart.cloneContexts(part);
        return newPart
      })
      
      newParts.forEach(function (p, i) {
        if (i === 0) return;
        console.log(i, newParts[i-1])
        Part.link(newParts[i - 1], p);
      })
      
      var conditionNode = new Part('general', [])
      
      Part.changeLink(prevs, part, conditionNode);
     
      if (!part.condition) {
        Part.link(conditionNode, newParts[0]);
        conditionNode.setCondition(condition);
        Part.unlink(part, next);
        Part.linkAlt(conditionNode, next);
      } else {
        var newExit = new Part('general', [])
        newExit.cloneContexts(part);
        newExit.setCondition(condition);
        Part.changePrevLink(part, newExit, [next, alt]);
        
        newExit.text = 'new Exit';
        
        Part.link(conditionNode, newParts[0]);
        conditionNode.setCondition(condition);
        Part.linkAlt(conditionNode, newExit);
      }
      
      Part.link(newParts[newParts.length - 1], conditionNode)
      
      parts.splice.apply(parts, [index, 1].concat([conditionNode]).concat(newParts));
      dirty = true;
    }
  }
  return dirty;
}