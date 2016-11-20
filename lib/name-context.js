function NameContext(used) {
    this.used = used.reduce(function (prev, curr) {
        prev[curr] = true;
        return prev;
    }, {});
}
NameContext.prototype.get = function (wished) {
    if (!this.used[wished]) {
        this.used[wished] = true;
        return wished;
    }
    var count = 0;
    var name = wished + count;
    while (this.used[name]) {
        count++;
        name = wished + count;
    }
    this.used[name] = true;
    return name;
}
module.exports = NameContext;