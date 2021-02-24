let t;

var a = function(){
    var c;
    var l = [];
    for(var n =0; n < 256; n++){
        c = n;
        for(var k =0; k < 8; k++){
            c = ((c&1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
        }
        l[n] = c;
    }
    return l;
}

var b = function(s) {
    var m = t || (t = a());
    var n = 0 ^ (-1);

    for (var i = 0; i < s.length; i++ ) {
        n = (n >>> 8) ^ m[(n ^ s.charCodeAt(i)) & 0xFF];
    }

    return (n ^ (-1)) >>> 0;
};
console.log(b(location.href))