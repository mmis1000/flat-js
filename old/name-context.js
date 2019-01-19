function NameContext(path) {
    this.path = path;
}
NameContext.prototype.get = function (wished) {
    return this.path.scope.generateUidIdentifier(wished);
}
module.exports = NameContext;