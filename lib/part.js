
function Part(nodes, prevs, next, condition, alt) {
    this.nodes = nodes.slice(0);
    this.prevs = prevs || [];
    this.next = next || null;;
    this.condition = condition || null;
    this.alt = alt || null;
    this.label = null;
    this.loopContexts = [];
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
    if (part === null) {
        part = []
    } else if (!Array.isArray(part)) {
        part = [part]
    }
    if (this.next) {
        if (0 <= this.next.prevs.indexOf(this)) {
            [].splice.apply(this.next.prevs, [this.next.prevs.indexOf(this), 1].concat(part))
        }
    }
}
Part.prototype.setNextOfPrev = function(part, from) {
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
Part.prototype.addLoopContext = function(contexts) {
    if (!Array.isArray(contexts)) contexts = [contexts]
    this.loopContexts = this.loopContexts.concat(contexts);
}
// chain parts together
Part.chain = function (parts) {
    for (var i = 0; i < parts.length; i++) {
        if (i !== 0) {
            parts[i].addPrev(parts[i - 1]);
        }
        if (i !== parts.length - 1) {
            parts[i].setNext(parts[i + 1]);
        }
    }
}


module.exports = Part;