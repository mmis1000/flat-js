
var fs = require("fs");
var file = fs.readFileSync('./index.js')
var babel = require('babel-core');

var p = require("./");

var ast = babel
    .transform(file, {
        presets: ['es2015']
    })
    .ast;
var code = babel
    .transformFromAst(ast, null,{
        plugins: ['./']
    })
    .code

console.log(code)