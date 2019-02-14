var b = 3

function test(a) {
    console.log(b, a, "test", 1)
    console.log(arguments)
    
    if (true) {
        console.log(a)
    }
    
    return a
}

(function(val){ console.log("iife", val) })(2)

var res = test("a")

console.log(res)