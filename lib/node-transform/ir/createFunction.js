/*
name string
label number
*/
module.exports = function createFunction(label) {
    this.label = label;
    this.length = 2;
    this.toCommand = function (index, list) {
      var found = null
      for (var i = 0; i < list.length; i++) {
        if (list[i].constructor.name === "functionLabel" && list[i].label === this.label) {
          found = list[i].offset
        }
      }

      return [
        "createFunction",
        found
      ]
    }
}