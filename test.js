var flat = require("./");
// console.log(flat('1 + 1'));
/*console.log(*/
var res = flat(`
var __flow=1;
function test() {
	return function(){}
}
var a,
    b = 0;
for (a = 0; a < 50; a++) {
	b++
	if (a > 30) {
	break;
	}
}
function c() {
switch (a) {
	case 1:
	case 2:
		break;
	default:
	  return 1;
}
}
`)/*.nodes);*/
// console.log(JSON.stringify(res.newAst, 0, 4))
// console.log(res.newText)

var fs = require("fs");
var file = fs.readFileSync('./index.js')
var res = flat(file);

console.log(res.newText)

