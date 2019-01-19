module.exports = function dupeVal(index) {
  this.index = index || 0;
  this.length = 2;
  this.toCommand = function (index, list) {
    return [
      "dupeVal",
      this.index
    ]
  }
}