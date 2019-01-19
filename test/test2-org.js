var a, b, c, d, e;

var console = {
  log: function(m) {
    global.console.log('log: ' + m)
  }
}

a = function (x) {
  return x + 1;
}
b = 1;
c = {y: 3};
d = [1, 2, 3];
e = function (x) {
  console.log(x);
}

b = a(b);

console.log(b)

with(c) {
  console.log(y)
}

try {
  console.log(y);
} catch (e) {
  console.log("pass");
}

d.map(e);

console.log(y);