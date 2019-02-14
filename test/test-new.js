var b = 3

function test(a) {
    console.log(b, a, "test", 1)
    console.log(arguments)
    
    if (true) {
        console.log(a, 'cond')
    }
    
    return a
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