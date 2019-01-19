var _uid9, _uid10, _uid11, _uid12, _uid15, _uid16, _uid17, A, B, C, D;

A = function A() {
    var nuzz, k, f;

    var _for_uid, _uid2, _uid3, _uid4, _uid5, _uid6, _binary_uid, _assign_uid, _uid13, _uid14;

    var a = 1,
        b = 2,
        c = { x: () => {
            return { y: 4 };
        } },
        d = () => {
        var _uid;

        _uid = true;

        if (_uid) {
            _uid = 4;
        } else {
            _uid = null;
        }

        return _uid;
    },
        e = 5,
        f = 6;

    nuzz = function nuzz() {
        console.log('I do nothing useful');
    };

    try {
        throw "test";
    } catch (err) {
        console.log(err);
    }

    _uid2 = a > 0;
    if (_uid2) {
        f = 1;
    } else {
        _uid3 = a < 0;
        if (_uid3) {
            f = 2;
        } else {
            _uid4 = f = 4;
            if (_uid4) {
                f = 3;
            }
        }
    }k = 'y';
    f = 0;
    _for_uid = f < 3;

    while (_for_uid) {
        e += 1;
        f++;
        _for_uid = f < 3;
    }

    nuzz();
    _uid5 = 1;

    if (_uid5) {
        _uid6 = d();

        if (_uid6) {
            _uid6 = 1;
        } else {
            _uid6 = 2;
        }

        _uid14 = c.x();
        _uid13 = _uid14[k];
        _assign_uid = _uid13 += _uid6;
        _binary_uid = b * _assign_uid;
        _uid5 = _binary_uid + e;
    }

    return a = _uid5;
};

B = function B() {
    var _binary_uid2;

    var a = 1,
        b = 2,
        c = 3;
    _binary_uid2 = c * 5;
    a += b = _binary_uid2;
    return a;
};

C = function C(x) {
    var _uid7, _binary_uid3;

    console.log(x);
    _uid7 = x <= 1;
    if (_uid7) {
        return 0;
    }_binary_uid3 = x - 1;
    return D(_binary_uid3);
};

D = function D(x) {
    var _uid8, _binary_uid4;

    console.log(x);
    _uid8 = x <= 1;
    if (_uid8) {
        return 0;
    }_binary_uid4 = x - 1;
    return C(_binary_uid4);
};

_uid15 = C(5);

console.log(_uid15);
_uid16 = A();
console.log(_uid16);
_uid17 = B();
console.log(_uid17);
eval(1);
(0, eval)(1);
_uid10 = 0;
_uid12 = !_uid10;

if (_uid12) {
    _uid10 = 0;
}

_uid9 = _uid10;
_uid11 = !_uid9;

if (_uid11) {
    _uid9 = eval;
}

_uid9(1);
