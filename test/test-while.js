function a(i) {
  var j = i;
  var k = 0;
  while (i--) {
    while (j--) {
      k++;
    }
  }
  return k;
}

console.log(a(10))