(function () {
    const codes = ["putNumber", 0, "initScope", "putNumber", 6, "jump", "putUndefined", "putString", "test", "newVar", "putUndefined", "putString", "res", "newVar", "putNumber", 17, "jump", "getScope", "putString", "test", "createFunction", 68, "setVal", "pop", "putNumber", 27, "jump", "getScope", "putString", "res", "getScope", "dupeVal", 0, "putString", "test", "getVal", "putString", "a", "putNumber", 1, "call", "setVal", "pop", "putNumber", 46, "jump", "getScope", "putString", "console", "getVal", "dupeVal", 0, "putString", "log", "getVal", "getScope", "putString", "res", "getVal", "putNumber", 1, "call", "pop", "putNumber", 66, "jump", "putUndefined", "leaveScope", "putString", "a", "putNumber", 1, "initScope", "putNumber", 76, "jump", "getScope", "putString", "console", "getVal", "dupeVal", 0, "putString", "log", "getVal", "getScope", "putString", "a", "getVal", "putString", "test", "putNumber", 1, "putNumber", 3, "call", "pop", "putNumber", 100, "jump", "getScope", "putString", "console", "getVal", "dupeVal", 0, "putString", "log", "getVal", "getScope", "putString", "arguments", "getVal", "putNumber", 1, "call", "pop", "putNumber", 120, "jump", "getScope", "putString", "a", "getVal", "leaveScope"];
    const globalScope = this || (typeof global !== "undefined" ? global : null) || (typeof window !== "undefined" ? window : null) || (typeof self !== "undefined" ? self : null);
    const IS_SCOPE = Symbol("is scope");
    const PARENT_SCOPE = Symbol("parent_scope");
    const THIS = Symbol("this");

    function CreateChildScope(scope) {
        const obj = Object.create(scope);
        Object.defineProperty(obj, PARENT_SCOPE, {
            configurable: false,
            enumerable: true,
            value: scope
        });
        Object.defineProperty(obj, IS_SCOPE, {
            configurable: false,
            enumerable: true,
            value: true
        });
        return obj;
    }

    function DefineVariable(scope, name) {
        var _value;

        Object.defineProperty(scope, name, {
            configurable: false,
            enumerable: true,

            set(val) {
                _value = val;
            },

            get() {
                return _value;
            }

        });
    }

    function HasVariable(scope, name) {
        return name in scope;
    }

    function InitScope(scope, self, names, fn, out_args) {
        Object.defineProperty(scope, THIS, {
            configurable: false,
            enumerable: true,
            value: self
        });
        var args = {};
        Object.defineProperty(args, "callee", {
            configurable: false,
            enumerable: true,
            value: fn
        });
        Object.defineProperty(args, "length", {
            configurable: false,
            enumerable: true,
            value: out_args.length
        });

        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            Object.defineProperty(args, i.toString(), {
                configurable: false,
                enumerable: true,

                set(val) {
                    scope[name] = val;
                },

                get() {
                    return scope[name];
                }

            });
        }

        Object.defineProperty(scope, "arguments", {
            configurable: false,
            enumerable: true,
            value: args
        });

        for (let i = 0; i < out_args.length; i++) {
            args[i] = out_args[i];
        }
    }

    var weak = new WeakMap();

    function GetInfo(obj) {
        return weak.get(obj);
    }

    function CreateFunction(scope, index) {
        function cb(...args) {
            var self = this;
            return run(scope, self, cb, index, args);
        }

        weak.set(cb, {
            scope,
            index
        });
        return cb;
    }

    var ops = {
        getScope(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.push(scope);
            };
        },

        putUndefined(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.push(undefined);
            };
        },

        putNumber(opcodes, index, skip) {
            skip(1);
            const number = opcodes[index + 1];
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.push(number);
            };
        },

        putString(opcodes, index, skip) {
            skip(1);
            const str = opcodes[index + 1];
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.push(str);
            };
        },

        dupeVal(opcodes, index, skip) {
            skip(1);
            const offset = opcodes[index + 1];
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.push(stack[stack.length - 1 - offset]);
            };
        },

        pop(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                stack.pop();
            };
        },

        jump() {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var point = stack.pop();
                jump(point);
            };
        },

        newVar(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var name = stack.pop();
                var value = stack.pop();
                DefineVariable(scope, name);
                scope[name] = value;
            };
        },

        setVal() {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var value = stack.pop();
                var name = stack.pop();
                var self = stack.pop();
                stack.push(value);

                if (self[IS_SCOPE] && !HasVariable(self, name)) {
                    throw new Error("unknown variable " + name);
                }

                self[name] = value;
            };
        },

        getVal() {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var name = stack.pop();
                var self = stack.pop();

                if (self[IS_SCOPE] && !HasVariable(self, name)) {
                    throw new Error("unknown variable " + name);
                }

                stack.push(self[name]);
            };
        },

        initScope(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var arg_names_length = stack.pop();
                var arg_names = [];

                while (arg_names_length--) {
                    arg_names.unshift(stack.pop());
                }

                var args_length = stack.pop();
                var args = [];

                while (args_length--) {
                    args.unshift(stack.pop());
                }

                var fn = stack.pop();
                var self = stack.pop();
                InitScope(scope, self, arg_names, fn, args);
            };
        },

        leaveScope(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump
            }) => {
                var argument = stack.pop();
                var returnPoint = stack.pop();
                stack.push(argument);
                jump(returnPoint);
                leave();
            };
        },

        call(opcodes, index, skip) {
            return ({
                scope,
                stack,
                leave,
                enter,
                jump,
                getInfo,
                currentIndex
            }) => {
                var args_length = stack.pop();
                var args = [];

                while (args_length--) {
                    args.unshift(stack.pop());
                }

                var fn = stack.pop();
                var self = stack.pop();
                var info = getInfo(fn);

                if (!info) {
                    if (self[IS_SCOPE]) {
                        self = globalScope;
                    }

                    var res = fn.apply(self, args);
                    stack.push(res);
                } else {
                    stack.push(currentIndex + 1);
                    stack.push(self);
                    stack.push(fn);
                    var original_length = args.length;

                    while (args.length) {
                        stack.push(args.shift());
                    }

                    stack.push(original_length);
                    var newScope = CreateChildScope(info.scope);
                    enter(newScope);
                    jump(info.index);
                }
            };
        },

        createFunction(opcodes, index, skip) {
            skip(1);
            const position = opcodes[index + 1];
            return ({
                scope,
                stack,
                leave,
                enter,
                jump,
                createFunction
            }) => {
                var func = createFunction(scope, position);
                stack.push(func);
            };
        }

    };
    var current = 0;
    var skip = 0;
    var baked = {};

    function skipFn(num) {
        skip = num;
    }

    while (current < codes.length) {
        skip = 0;
        baked[current] = ops[codes[current]](codes, current, skipFn);
        baked[current].nextIndex = current + 1 + skip;
        current = current + 1 + skip;
    }

    function run(scope, self, fn, index, args) {
        var callStack = [scope];
        var stack = [-1, self, fn, ...args, args.length];

        function enter(scope) {
            callStack.push(scope);
        }

        function leave() {
            callStack.pop();
        }

        function currentScope() {
            return callStack[callStack.length - 1];
        }

        function jump(index) {
            nextIndex = index;
        }

        var ctx = {
            scope: currentScope(),
            stack,
            leave,
            enter,
            jump,
            currentIndex: index,
            createFunction: CreateFunction,
            getInfo: GetInfo
        };
        var nextIndex = ctx.currentIndex + 1;

        function pad(str, len) {
            while (str.length < len) {
                str = str + " ";
            }

            return str;
        }

        function showStack(stack) {
            return JSON.stringify(stack.map(i => typeof i === "function" ? 'function' : typeof i === "object" && i ? 'object' : i + ""));
        }

        while (baked[ctx.currentIndex]) {
            nextIndex = baked[ctx.currentIndex].nextIndex;
            ctx.scope = currentScope();
            baked[ctx.currentIndex](ctx);
            ctx.currentIndex = nextIndex;
        }

        return ctx.stack.pop();
    }

    run(CreateChildScope(globalScope), globalScope, undefined, 0, []);
})();
