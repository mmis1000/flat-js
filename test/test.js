function A() {
    var a = 1, b = 2, c = {x: ()=> {return {y: 4}}} ,d = ()=> (true ? 4 : null) ,e = 5, f = 6;
    
    function nuzz() {
        console.log('I do nothing useful')
    }
    
    try {
        throw "test"
    } catch (err) {
        console.log(err);
    }
    
    if (a > 0) {
        f = 1;
    } else if (a < 0) {
        f = 2;
    } else if (f = 4){
        f = 3;
    }
    var k = 'y'
    for (var f = 0; f < 3; f++) e+=1;
    nuzz();
    return a = 1 && b * (c.x()[k] += d() ? 1 : 2) + e
}
function B() {
    var a = 1, b = 2 ,c = 3;
    a += b = c * 5;
    return a;
}
function C(x) {
    console.log(x)
    if (x <= 1) return 0;
    return D(x-1)
}
function D(x) {
    console.log(x)
    if (x <= 1) return 0;
    return C(x-1)
}
console.log(C(5));
console.log(A());
console.log(B());
eval(1);
(0,eval)(1);
(0 || 0 || eval)(1)