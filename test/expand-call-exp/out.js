var _uid7, _uid8, _uid9, _uid10, _uid12, _uid13, A, B;

assignmentOperate(getReference('A'), function A() {
    var nuzz, f;

    var _for_uid, _uid2, _uid3, _uid4, _uid5, _uid6, _binary_uid, _assign_uid, _uid11;

    var a = 1,
        b = 2,
        c = { x: () => {
            return { y: 4 };
        } },
        d = () => {
        var _uid;

        assignmentOperate(getReference('_uid'), true, '=');

        if (getValue(getReference('_uid'))) {
            assignmentOperate(getReference('_uid'), 4, '=');
        } else {
            assignmentOperate(getReference('_uid'), null, '=');
        }

        return getValue(getReference('_uid'));
    },
        e = 5,
        f = 6;

    assignmentOperate(getReference('nuzz'), function nuzz() {
        __jump0__ = resultOf(getReference('log', getReference('console')), ['I do nothing useful']);

        getValue('__resume0__');
    }, '=');
    assignmentOperate(getReference('_uid2'), binaryOperate(getReference('a'), 0, '>'), '=');


    if (getValue(getReference('_uid2'))) {
        assignmentOperate(getReference('f'), 1, '=');
    } else {
        assignmentOperate(getReference('_uid3'), binaryOperate(getReference('a'), 0, '<'), '=');
        if (getValue(getReference('_uid3'))) {
            assignmentOperate(getReference('f'), 2, '=');
        } else {
            assignmentOperate(getReference('_uid4'), assignmentOperate(getReference('f'), 4, '='), '=');
            if (getValue(getReference('_uid4'))) {
                assignmentOperate(getReference('f'), 3, '=');
            }
        }
    }assignmentOperate(getReference('f'), 0, '=');
    assignmentOperate(getReference('_for_uid'), binaryOperate(getReference('f'), 3, '<'), '=');

    while (getValue(getReference('_for_uid'))) {
        assignmentOperate(getReference('e'), 1, '+=');
        getValue(updateOperate(getReference('f'), '++', false));
        assignmentOperate(getReference('_for_uid'), binaryOperate(getReference('f'), 3, '<'), '=');
    }

    __jump1__ = resultOf(getReference('nuzz'), []);
    getValue('__resume1__');
    assignmentOperate(getReference('_uid5'), 1, '=');

    if (getValue(getReference('_uid5'))) {
        __jump2__ = resultOf(getReference('d'), []);
        assignmentOperate(getReference('_uid6'), '__resume2__', '=');

        if (getValue(getReference('_uid6'))) {
            assignmentOperate(getReference('_uid6'), 1, '=');
        } else {
            assignmentOperate(getReference('_uid6'), 2, '=');
        }

        __jump3__ = resultOf(getReference('x', getReference('c')), []);
        assignmentOperate(getReference('_uid11'), '__resume3__', '=');
        assignmentOperate(getReference('_assign_uid'), assignmentOperate(getReference('y', getReference('_uid11')), getReference('_uid6'), '+='), '=');
        assignmentOperate(getReference('_binary_uid'), binaryOperate(getReference('b'), getReference('_assign_uid'), '*'), '=');
        assignmentOperate(getReference('_uid5'), binaryOperate(getReference('_binary_uid'), getReference('e'), '+'), '=');
    }

    return assignmentOperate(getReference('a'), getReference('_uid5'), '=');
}, '=');
assignmentOperate(getReference('B'), function B() {
    var _binary_uid2;

    var a = 1,
        b = 2,
        c = 3;
    assignmentOperate(getReference('_binary_uid2'), binaryOperate(getReference('c'), 5, '*'), '=');
    assignmentOperate(getReference('a'), assignmentOperate(getReference('b'), getReference('_binary_uid2'), '='), '+=');
    return getValue(getReference('a'));
}, '=');
__jump4__ = resultOf(getReference('A'), []);
assignmentOperate(getReference('_uid12'), '__resume4__', '=');
__jump5__ = resultOf(getReference('log', getReference('console')), [getValue(getReference('_uid12'))]);

getValue('__resume5__');
__jump6__ = resultOf(getReference('B'), []);
assignmentOperate(getReference('_uid13'), '__resume6__', '=');
__jump7__ = resultOf(getReference('log', getReference('console')), [getValue(getReference('_uid13'))]);
getValue('__resume7__');
__jump8__ = resultOf(getReference('eval'), [1]);
getValue('__resume8__');
__jump9__ = resultOf((0, getValue(getReference('eval'))), [1]);
getValue('__resume9__');
assignmentOperate(getReference('_uid8'), 0, '=');
assignmentOperate(getReference('_uid10'), unaryOperate(getReference('_uid8'), '!', true), '=');

if (getValue(getReference('_uid10'))) {
    assignmentOperate(getReference('_uid8'), 0, '=');
}

assignmentOperate(getReference('_uid7'), getReference('_uid8'), '=');
assignmentOperate(getReference('_uid9'), unaryOperate(getReference('_uid7'), '!', true), '=');

if (getValue(getReference('_uid9'))) {
    assignmentOperate(getReference('_uid7'), getReference('eval'), '=');
}

__jump10__ = resultOf(getReference('_uid7'), [1]);
getValue('__resume10__');
