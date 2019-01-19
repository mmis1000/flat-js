module.exports = function putNumber(val){
  this.val = val
  this.length = 2;
  this.toCommand = function (index, list) {
    return [
      "putNumber",
      this.val
    ]
  }
}