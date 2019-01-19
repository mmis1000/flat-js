function LoopContext(entry, exit, labels) {
    this.entry = entry;
    this.exit = exit;
    this.labels = labels || [];
}

LoopContext.prototype.updateEntry = function(from, to) {
    if (from === this.entry) {
        to = this.entry;
    }
};
LoopContext.prototype.updateExit = function(from, to) {
    if (from === this.exit) {
        to = this.exit;
    }
};


module.exports = LoopContext;