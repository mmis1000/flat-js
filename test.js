var flat = require("./");
// console.log(flat('1 + 1'));
/*console.log(*/
var res = flat(`
var a = 1;
var b = 0;
if (a > 0) {
	b += 1
}
for (var c = 0; c < 11; c++) {
	for (var d = 0; d < 2; d++) {
		let _d = d;
		processs.on(function () {
			log(_d)
		})
		b++;
	}
}
for (var c = 0; c < 11; c++) {
	for (var d = 0; d < 2; d++) {
		let _d = d;
		processs.on(function () {
			log(_d)
		})
		b++;
	}
}
for (let e = 0; e <55; e++) b++;
`)/*.nodes);*/
console.log(JSON.stringify(res.newAst, 0, 4))
console.log(res.newText)