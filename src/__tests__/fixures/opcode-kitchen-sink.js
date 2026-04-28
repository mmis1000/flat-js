;

var outerVar = 10;
let outerLet = 20;
const outerConst = 30;
let topLevelTdz;

const target = {
    count: 1,
    nested: { value: 2 },
    list: [1, 2, 3],
    flag: false,
    text: 'hello',
};

target.count += 1;
target.count -= 1;
target.count /= 1;
target.count *= 2;
target.count >>>= 1;
target.count++;
target.count--;
++target.count;
--target.count;
delete target.missing;
typeof target.count;
typeof missingGlobal;
target.flag && target.count;
target.flag || target.count;
/kitchen-sink/gi;
[0, ...target.list, 9];
({
    shorthand: target,
    plain: 1,
    method(x) { return x + 1; },
});

function directEval(code) {
    return eval(code);
}

function directEvalSpread(parts) {
    return eval(...parts);
}

function callValue(fn) {
    return fn(1, 2);
}

function callValueSpread(fn, args) {
    return fn(...args);
}

function bindAndCall(fn, self) {
    return fn.bind(self, 1)(2);
}

function makeFunctionCtor() {
    return new Function('a', 'b', 'return a + b;');
}

function readTagged(strings) {
    return strings.raw[0];
}

function breakThroughFinally(values) {
    for (const value of values) {
        try {
            if (value > 1) {
                break;
            }
        } finally {
            target.flag = !target.flag;
        }
    }
}

function throwReferenceErrorPath() {
    return missingBinding;
}

function throwNormally() {
    throw 1;
}

function makeStatics() {
    var unchecked = 1;
    let checked = 2;
    const frozen = 3;
    let delayed;

    delayed = checked;
    unchecked = unchecked + 1;
    checked = checked + 1;

    function writeUnchecked() {
        unchecked += 1;
        unchecked -= 1;
        unchecked /= 1;
        unchecked *= 1;
        unchecked >>>= 1;
        unchecked++;
        unchecked--;
        ++unchecked;
        --unchecked;
        return typeof unchecked;
    }

    function writeChecked() {
        checked += 1;
        checked -= 1;
        checked /= 1;
        checked *= 1;
        checked >>>= 1;
        checked++;
        checked--;
        ++checked;
        --checked;
        return typeof checked;
    }

    function readConst() {
        return frozen + outerConst;
    }

    function typeofChecked() {
        return typeof checked;
    }

    function typeofUnchecked() {
        return typeof unchecked;
    }

    function unaryChecked() {
        return -checked;
    }

    return {
        writeUnchecked,
        writeChecked,
        readConst,
        typeofChecked,
        typeofUnchecked,
        unaryChecked,
    };
}

class BaseBox {
    constructor(value) {
        this.value = value;
    }

    method(extra) {
        return this.value + extra;
    }

    get doubled() {
        return this.value * 2;
    }

    set doubled(next) {
        this.value = next / 2;
    }
}

class DerivedBox extends BaseBox {
    constructor(...args) {
        super(...args);
        this.kind = 'derived';
    }

    method(...args) {
        return super.method(...args) * 2;
    }

    static create() {
        return new DerivedBox(...[4]);
    }
}

function* counter(start) {
    yield start;
    yield start + 1;
    yield* [start + 2, start + 3];
    return start + 4;
}

async function asyncPath(promiseLike) {
    debugger;
    try {
        return await promiseLike;
    } finally {
        target.flag = true;
    }
}

for (const key in target) {
    target.flag = key in target;
}

for (const item of target.list) {
    outerLet += item;
}

switch (target.text) {
    case 'hello':
        outerVar += 1;
        break;
    default:
        outerVar -= 1;
}

try {
    throw new Error('boom');
} catch (error) {
    target.caught = error.message;
} finally {
    target.finalized = true;
}

directEval('1 + 2');
directEvalSpread(['1 + 2']);
callValue(function (a, b) { return a + b; });
callValueSpread(function (a, b) { return a + b; }, [1, 2]);
bindAndCall(function (a, b) { return this.base + a + b; }, { base: 5 });
makeFunctionCtor()('3', '4');
makeStatics();
DerivedBox.create();
readTagged`line\nbreak`;
counter(1);
asyncPath(Promise.resolve(5));
breakThroughFinally([1, 2, 3]);
throwReferenceErrorPath;
throwNormally;

{
    let blockTdz;
    blockTdz = outerVar;
}

({
    plus: 1 + 2,
    minus: 4 - 1,
    multiply: 2 * 3,
    divide: 8 / 2,
    modulo: 9 % 4,
    eq: 1 == '1',
    seq: 1 === 1,
    neq: 1 != 2,
    sneq: 1 !== 2,
    gt: 2 > 1,
    gte: 2 >= 2,
    lt: 1 < 2,
    lte: 2 <= 2,
    bitAnd: 3 & 1,
    bitOr: 1 | 2,
    bitXor: 3 ^ 1,
    shl: 1 << 2,
    shr: 8 >> 1,
    ushr: -1 >>> 1,
    unaryPlus: +'2',
    unaryMinus: -outerVar,
    logicalNot: !0,
    bitwiseNot: ~1,
    instanceOf: [] instanceof Array,
    inCheck: 'count' in target,
    ternary: target.flag ? outerVar : outerLet,
});
