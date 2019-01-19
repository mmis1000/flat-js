function assignmentOperate() {}function binaryOperate() {}function A() {
    var _uid, _uid2, _uid3, _uid4, _uid5, _binary_uid, _uid6;

    var a = 1,
        b = 2,
        c = { x: () => {
            return { y: 4 };
        } },
        d = () => {
        4;
    },
        e = 5,
        f = 6;
    _uid2 = a > 0;
    if (_uid2) {
        f = 1;
    } else {
        _uid3 = a < 0;
        if (_uid3) {
            f = 2;
        } else {
            f = 3;
        }
    }var f = 0;_uid = f < 3

    while (_uid) {
        e += 1;
        f++;
        _uid = f < 3
    }

    _uid4 = 1;

    if (_uid4) {
        _uid5 = d();

        if (_uid5) {
            _uid5 = 1;
        } else {
            _uid5 = 2;
        }

        _uid6 = c.x();
        _binary_uid = b * (_uid6.y += _uid5);
        _uid4 = _binary_uid + e;
    }

    return a = _uid4;
}