var b = 3

function test(a) {
    console.log(b, a, "test", 1)
    console.log(arguments)
    
    if (2 + 1101 < 155) {
        console.log(a, 'cond')
    }
    
    return a
}

function testRecursive(from, moveTo) {
    if (from > 0) {
        return testRecursive(from - 1, moveTo + 1)
    } else {
        return moveTo
    }
}


function closureTest(val) {
    return function () {
        return val
    }
}

;(function(val){ console.log("iife", val) })(2)

var res = test("a")

console.log(res)

console.log(closureTest('closure value')())
console.log(testRecursive(100000, 0))