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
      while (t.isBreakStatement(part.nodes[0])) {
        dirty = true;
        Part.unlink(part, next);
        Part.unlink(part, alt);
        part.setCondition(null)
        
        var node = part.nodes[0];
        var label = node.label ? node.label.name : null;
        var newNextPart = null;
        for (var i = part.loopContexts.length - 1; i >= 0; i--) {
          if (label === part.loopContexts[i].label) {
            newNextPart = part.loopContexts[i].exit;
            part.nodes = [];
            Part.link(part, newNextPart);
            break;
          }
        }
        
      }
    }
  }
}