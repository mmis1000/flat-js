module.exports = function putBoolean(val){
  this.val = val
  this.length = 2;
  this.toCommand = function (index, list) {
    return [
      "putBoolean",
      this.val
    ]
  }
}