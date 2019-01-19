module.exports = function numberFromPart(part) {
  this.part = part;
  this.length = 2;
  this.toCommand = function (index, list) {
    return [
      "putNumber",
      part.irs[0].offset
    ]
  }
}