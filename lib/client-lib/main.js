(function () { 
    const codes = __CODE_PARTS__;

    const globalScope = this || 
        (typeof global !== "undefined"? global: null) ||
        (typeof window !== "undefined"? window: null) ||
        (typeof self !== "undefined"? self: null)

    const IS_SCOPE = Symbol("is scope")
    const PARENT_SCOPE = Symbol("parent_scope")
    const THIS = Symbol("this")
    const RETURN_POINTER = Symbol("return_pointer")
    const IS_RECORD = Symbol("is_record")
    const STACK = Symbol("stack")


    function CreateChildScope(scope) {
        let obj
        
        if (scope[IS_SCOPE]) {
            obj = Object.create(null)
            // ignore global object
            Object.defineProperty(obj, PARENT_SCOPE, {
                configurable: false,
                enumerable: true,
                value: scope
            })
        } else {
            // shadow root
            obj = Object.create(scope)
            Object.defineProperty(obj, PARENT_SCOPE, {
                configurable: false,
                enumerable: true,
                value: {
                    [IS_SCOPE]: true,
                    [IS_RECORD]: true,
                    [STACK]: []
                }
            })
        }

        Object.defineProperty(obj, IS_SCOPE, {
            configurable: false,
            enumerable: true,
            value: true
        })

        Object.defineProperty(obj, IS_RECORD, {
            configurable: false,
            enumerable: true,
            value: true
        })

        Object.defineProperty(obj, STACK, {
            configurable: false,
            enumerable: true,
            value: []
        })

        return obj
    }

    /**
     * define a new variable
     * @param {Object} scope Scope object
     * @param {string} name Create object on scope
     */
    function DefineVariable(scope, name) {
        var _value;

        Object.defineProperty(scope, name, {
            configurable: false,
            enumerable: true,
            set(val) { _value = val },
            get() { return _value }
        })
    }

    /**
     * check whether object / scope has that prop
     * @param {Object} scope Scope object
     * @param {string} name Create object on scope
     */
    function HasVariable(scope, name) {
        if (!scope[IS_SCOPE]) {
            return name in scope
        }
        
        for (;;) {
            if (name in scope) {
                return true
            }
            
            if (!scope[PARENT_SCOPE]) {
                break
            } else {
                scope = scope[PARENT_SCOPE]
            }
        }
        
        return false;
    }


    /**
     * set object / scope has that prop
     * @param {Object} scope Scope object
     * @param {string} name Create object on scope
     * @param {any} value any value
     */
    function SetVariable(scope, name, value) {
        if (!scope[IS_SCOPE]) {
            scope[name] = value
        }
        
        for (;;) {
            if (name in scope) {
                scope[name] = value
            }
            
            if (!scope[PARENT_SCOPE]) {
                break
            } else {
                scope = scope[PARENT_SCOPE]
            }
        }
        
        return false;
    }

    /**
     * get object / scope has that prop
     * @param {Object} scope Scope object
     * @param {string} name Create object on scope
     */
    function GetVariable(scope, name) {
        if (!scope[IS_SCOPE]) {
            return scope[name]
        }
        
        for (;;) {
            if (name in scope) {
                return scope[name]
            }
            
            if (!scope[PARENT_SCOPE]) {
                break
            } else {
                scope = scope[PARENT_SCOPE]
            }
        }
        
        throw new ReferenceError("variable " + name + " not exist")
    }
    
    /**
     * 
     * @param {Object} scope Scope object
     * @param {string} name Create object on scope
     */
    function GetSelf(scope, name) {
        for (;;) {
            if (name in scope) {
                return scope
            }
            
            if (!scope[PARENT_SCOPE]) {
                break
            } else {
                scope = scope[PARENT_SCOPE]
            }
        }
        
        throw new ReferenceError("variable " + name + " not exist")
    }

    /**
     * init scope
     * @param {Object} scope Scope Object
     * @param {any} self this
     * @param {string[]} names argument names
     * @param {function} fn callee
     * @param {any[]} out_args supplied arguments
     */
    function InitScope(scope, self, names, fn, out_args) {
        Object.defineProperty(scope, THIS, {
            configurable: false,
            enumerable: true,
            value: self
        })

        var args = {}

        Object.defineProperty(args, "callee", {
            configurable: false,
            enumerable: true,
            value: fn
        })

        Object.defineProperty(args, "length", {
            configurable: false,
            enumerable: true,
            value: out_args.length
        })

        for (let i = 0; i < names.length; i++) {
            let name = names[i]

            Object.defineProperty(args, i.toString(), {
                configurable: false,
                enumerable: true,
                set(val) { scope[name] = val },
                get() { return scope[name]  }
            })
        }

        Object.defineProperty(scope, "arguments", {
            configurable: false,
            enumerable: true,
            value: args
        })

        for (let i = 0; i < out_args.length; i++) {
            args[i] = out_args[i]
        }
    }

    var weak = new WeakMap()

    function GetInfo(obj) {
        return weak.get(obj)
    }

    function CreateFunction(scope, index) {
        function cb(...args) {
            var self = this
            return run(scope, self, cb, index, args)
        }

        weak.set(cb, {
            scope,
            index
        })

        return cb
    }

    var ops = {
        // operations that does not touch scope
        getScope(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                stack.push(scope)
            }
        },
        putUndefined(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                stack.push(undefined)
            }
        },
        putNumber(opcodes, index, skip) {
            skip(1)
            const number = opcodes[index + 1]

            return ({scope, stack, leave, enter, jump})=>{
                stack.push(number)
            }
        },
        putString(opcodes, index, skip) {
            skip(1)
            const str = opcodes[index + 1]

            return ({scope, stack, leave, enter, jump})=>{
                stack.push(str)
            }
        },
        putBoolean(opcodes, index, skip) {
            skip(1)
            const bool = opcodes[index + 1]

            return ({scope, stack, leave, enter, jump})=>{
                stack.push(bool)
            }
        },
        dupeVal(opcodes, index, skip) {
            skip(1)
            const offset = opcodes[index + 1]

            return ({scope, stack, leave, enter, jump})=>{
                stack.push(stack[stack.length - 1 - offset])
            }
        },
        pop(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                stack.pop()
            }
        },
        condition() {
            return ({scope, stack, leave, enter, jump})=>{
                var cond = stack.pop()
                var alt = stack.pop()
                var org = stack.pop()
                
                if (cond) {
                    stack.push(org)
                } else {
                    stack.push(alt)
                }
            }
        },
        jump() {
            return ({scope, stack, leave, enter, jump})=>{
                var point = stack.pop()
                jump(point)
            }
        },
        // operations that touch scope
        newVar(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                var name = stack.pop()
                var value = stack.pop()
                DefineVariable(scope, name)
                SetVariable(scope, name, value)
            }
        },
        setVal() {
            return ({scope, stack, leave, enter, jump})=>{
                var value = stack.pop()
                var name = stack.pop()
                var self = stack.pop()
                stack.push(value)
                SetVariable(self, name, value)
            }
        },
        getVal() {
            return ({scope, stack, leave, enter, jump})=>{
                var name = stack.pop()
                var self = stack.pop()

                stack.push(GetVariable(self, name))
            }
        },
        initScope(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                var arg_names_length = stack.pop()
                var arg_names = []
                // console.log(arg_names_length)
                while (arg_names_length--) {arg_names.unshift(stack.pop())}

                var args_length = stack.pop()
                var args = []
                // console.log(args_length)
                while (args_length--) {args.unshift(stack.pop())}

                var fn = stack.pop()
                var self = stack.pop()

                InitScope(scope, self, arg_names, fn, args)
            }
        },
        leaveScope(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump})=>{
                var argument = stack.pop()
                var returnPoint = scope[RETURN_POINTER]
                scope[PARENT_SCOPE][STACK].push(argument)
                
                jump(returnPoint)
                leave()
            }
        },
        call(opcodes, index, skip) {
            return ({scope, stack, leave, enter, jump, getInfo, currentIndex})=>{

                var args_length = stack.pop()
                var args = []
                while (args_length--) {args.unshift(stack.pop())}

                var identifier = stack.pop()
                var self = stack.pop()
                var indeedSelf = GetSelf(self, identifier)
                var func = indeedSelf[identifier]

                var info = getInfo(func) // whether it is internal?

                if (!info) {
                    // external function
                    if (indeedSelf[IS_RECORD]) {
                        self = globalScope
                    }
                    
                    var res = func.apply(self, args)
                    stack.push(res)
                } else {
                    var newScope = CreateChildScope(info.scope)
                    // add current index
                    newScope[RETURN_POINTER] = currentIndex + 1
                    
                    newScope[STACK].push(self)
                    newScope[STACK].push(func)
                    
                    var original_length = args.length
                    
                    while (args.length) {
                        newScope[STACK].push(args.shift())
                    }
                    
                    newScope[STACK].push(original_length)

                    enter(newScope)
                    jump(info.index)
                }
            }
        },
        callIntr() {
            return ({scope, stack, leave, enter, jump, getInfo, currentIndex})=>{

                var args_length = stack.pop()
                var args = []
                while (args_length--) {args.unshift(stack.pop())}

                var func = stack.pop()

                var info = getInfo(func) // whether it is internal?

                if (!info) {
                    // external function
                    var res = func.apply(globalScope, args)
                    stack.push(res)
                } else {
                    var newScope = CreateChildScope(info.scope)
                    // add current index
                    newScope[RETURN_POINTER] = currentIndex + 1
                    newScope[STACK].push(globalScope)
                    newScope[STACK].push(func)
                    var original_length = args.length
                    
                    while (args.length) {
                        newScope[STACK].push(args.shift())
                    }
                    
                    newScope[STACK].push(original_length)

                    enter(newScope)
                    jump(info.index)
                }
            }
        },
        createFunction(opcodes, index, skip) {
            skip(1)
            const position = opcodes[index + 1]

            return ({scope, stack, leave, enter, jump, createFunction})=>{
                var func = createFunction(scope, position)
                stack.push(func)
            }
        }
    }

    var current = 0;
    var skip = 0;
    var baked = {}
    function skipFn(num) { skip = num }

    while (current < codes.length) {
        skip = 0
        
        baked[current] = ops[codes[current]](codes, current, skipFn)
        baked[current].nextIndex = current + 1 + skip

        current = current + 1 + skip
    }

    function run(scope, self, fn, index, args) {
        var callStack = [scope]
        scope[STACK] = scope[STACK].concat([-1, self, fn, ...args, args.length])

        function enter(scope) {
            callStack.push(scope)
        }

        function leave() {
            if (callStack.length === 1) return
            callStack.pop()
        }

        function currentScope() {
            return callStack[callStack.length - 1]
        }

        function jump(index) {
            nextIndex = index
        }

        var ctx = {
            scope: currentScope(), 
            stack: currentScope()[STACK], 
            leave, 
            enter, 
            jump, 
            currentIndex: index,
            createFunction: CreateFunction,
            getInfo: GetInfo
        }

        var nextIndex = ctx.currentIndex + 1;

        function pad(str, len) {
            while (str.length < len) {
                str = str + " "
            }
            return str
        }

        function showStack(stack) {
            return JSON.stringify(stack.map(i=>
                typeof i === "function"? 'function':
                (typeof i === "object" && i)? 'object':
                i + ""
            ))
        }

        while (baked[ctx.currentIndex]) {
            nextIndex = baked[ctx.currentIndex].nextIndex
            ctx.scope = currentScope()
            ctx.stack = currentScope()[STACK]

            //console.log("before",pad(codes[ctx.currentIndex], 12), ctx.currentIndex, showStack(ctx.stack))
            baked[ctx.currentIndex](ctx)
            //console.log("after ",pad(codes[ctx.currentIndex], 12),ctx.currentIndex, showStack(ctx.stack))

            ctx.currentIndex = nextIndex
        }

        return currentScope()[STACK][0]
    }

    run(CreateChildScope(globalScope), globalScope, undefined, 0, [])
} ())