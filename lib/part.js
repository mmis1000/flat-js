function Part(type, nodes, prevs, next, condition, alt) {
  // type: head, general, try, leave_try, catch, leave_catch, with, leave_with
  this.type = type;
  this.nodes = nodes.slice(0);
  this.info = null;
  this.text = ""
  /*
    try : {
      catchPoint: Label
    }
    catch : {
      errName: String
    }
    with : {
      withObjectName: String
    }
  */
  
  this.prevs = prevs || [];
  this.next = next || null;;
  this.condition = condition || null;
  this.alt = alt || null;
  this.label = null;
  this.loopContexts = [];
  this.concatable = true;
  
  this.updateConcatable();
}

Part.prototype.setCondition = function setCondition(condition) {
  this.condition = condition || null;
}

Part.prototype.connectNext = function(next) {
  if (this.next) {
    throw new Error("already has item connected")
  }
  this.next = next;
  next.prevs.push(this);
  next.updateConcatable();
}

Part.prototype.connectAlt = function(alt) {
  if (this.alt) {
    throw new Error("already has item connected")
  }
  this.alt = alt;
  this.updateConcatable();
  alt.prevs.push(this);
  alt.updateConcatable();
}

Part.prototype.connectPrev = function(prev) {
  if (prev.next) {
    throw new Error("already has item connected")
  }
  this.prevs.push(prev);
  this.updateConcatable();
  prev.next = this;
}

Part.prototype.connectPrevAlt = function(prev) {
  if (prev.alt) {
    throw new Error("already has item connected")
  }
  this.prevs.push(prev);
  this.updateConcatable();
  prev.alt = this;
  prev.updateConcatable();
}

Part.prototype.canConcatPrev = function() {
  if (!this.concatable) return false;
  if (this.prevs.length > 0) {
    return this.prevs[0].concatable;
  } else {
    return false;
  }
}

Part.prototype.updateConcatable = function() {
  if (this.type !== "general") {
    this.concatable = false;
  }
  
  if (this.alt) {
    this.concatable = false;
  }
  
  if (this.prevs.length > 1) {
    this.concatable = false;
  }
}

Part.prototype.addLoopContext = function (ctx) {
  this.loopContexts.push(ctx);
}

Part.prototype.addLoopContexts = function (ctxs) {
  ctxs.forEach(function (ctx) {
    this.loopContexts.push(ctx);
  }.bind(this))
}

Part.prototype.cloneContexts = function (part) {
  this.loopContexts = [];
  this.addLoopContexts(part.loopContexts)
}

Part.link = function link(first, second) {
  first.connectNext(second);
}

Part.linkAlt = function linkAlt(first, second) {
  first.connectAlt(second);
}

Part.unlink = function unlink(first, second, noSuppressError) {
  if ((!first || !second) && noSuppressError) {
    throw new Error('one of the node does not exist');
  }

  if (!first || !second) {
    return
  }
  
  if (Array.isArray(first) || Array.isArray(second)) {
    first = Array.isArray(first) ? first : [first];
    second = Array.isArray(second) ? second : [second];
    first.forEach(function(part1) {
      second.forEach(function(part2) {
        Part.unlink(part1, part2);
      })
    })
  }
  
  if (first.next === second) {
    first.next = null;
    second.prevs = second.prevs.filter(function (el) {
      return el !== first
    });
  } else if (first.alt === second) {
    first.alt = null;
    second.prevs = second.prevs.filter(function (el) {
      return el !== first
    });
  } else if (noSuppressError) {
    throw new Error('expect second element found in next or alt branch, but neither')
  }
}

Part.changeLink = function changeLink(first, second, newSecond, noSuppressError) {
  if ((!first || !second) && noSuppressError) {
    throw new Error('one of the node does not exist');
  }
  
  if (Array.isArray(first)) {
    first.forEach(function(part1) {
      Part.changeLink(part1, second, newSecond)
    })
  }
  
  if (first.next === second) {
    first.next = null;
    second.prevs = second.prevs.filter(function (el) {
      return el !== first
    });
    Part.link(first, newSecond);
  } else if (first.alt === second) {
    first.alt = null;
    second.prevs = second.prevs.filter(function (el) {
      return el !== first
    });
    Part.linkAlt(first, newSecond);
  } else if (noSuppressError) {
    throw new Error('expect second element found in next or alt branch, but neither')
  }
}

Part.changePrevLink = function(prev, newPrev, parts) {
  if (!Array.isArray(parts)) {
    parts = [parts]
  }
  
  parts.forEach(function(part) {
    if (!part) return;
    if (part.prevs.indexOf(prev) > 0) {
      if (prev.next === part) {
        prev.next = null;
        part.prevs = part.prevs.filter(function (el) {
          return el !== prev
        });
        Part.link(newPrev, part);
      }
      
      if (prev.alt === part) {
        prev.alt = null;
        part.prevs = part.prevs.filter(function (el) {
          return el !== prev
        });
        Part.linkAlt(newPrev, part);
      }
    }
  })
}

module.exports = Part;