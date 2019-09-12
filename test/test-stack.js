(function () {

var stack = []

var ctx = {
  'a': 1,
  'b': 3,
  'c': null
}

function read() {
  stack.push(ctx[stack.pop()]);
}

function write() {
  var id = stack.pop();
  var val = stack.pop();
  ctx[id] = val;
}

function add() {
  stack.push(stack.pop() + stack.pop());
}

function push (val) {
  stack.push(val)
}

function drop() {
  stack.pop()
}

function _pop() {
  return stack.pop()
}

function call() {
  var obj = stack.pop();
  var prop = stack.pop();
  var len = stack.pop();
  var args = []
  while (len--) {
    args.unshift(stack.pop());
  }
  push(obj[prop].apply(obj, args))
}

push('a')
read();
push('b')
read();
add();
push('c')
write()

push('a')
push('b')
push('c')
push('c')
read()
push(4)
push('log')
push(console);
call()

return _pop()
} ())