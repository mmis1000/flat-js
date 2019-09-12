module.exports = function putString(str) {
  this.str = str
  this.length = 2
  this.toCommand = function (index, list) {
    return [
      "putString",
      this.str
    ]
  }
}