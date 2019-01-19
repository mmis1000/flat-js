function test(a) {
    console.log(a, "test", 1)
    console.log(arguments)
    return a
}

var res = test("a")

console.log(res)