{
// [START_HERE]
// MUST SYNC WITH COMPILER
const TEXT_DADA_MASK = 0x80000000;
// MUST SYNC WITH COMPILER
const isSmallNumber = (a) => {
    return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0);
};
const CALL = Function.prototype.call;
const APPLY = Function.prototype.apply;
const BIND = Function.prototype.bind;
const REGEXP = RegExp;
const is_not_defined = ' is not defined';
const is_a_constant = ' is a constant';
function run(program, textData, entryPoint = 0, scopes = [], self = undefined, args = []) {
    const environments = new WeakSet();
    const initialFrame = {
        [0 /* type */]: 0 /* Function */,
        [2 /* scopes */]: scopes,
        [3 /* valueStack */]: [
            self,
            undefined,
            undefined,
            0 /* Apply */,
            ...args,
            args.length
        ],
        [19 /* invokeType */]: 0 /* Apply */,
        [4 /* return */]: -1
    };
    environments.add(initialFrame);
    const stack = [initialFrame];
    let ptr = entryPoint;
    const read = () => program[ptr++];
    const getCurrentFrame = () => stack[stack.length - 1];
    const peak = (arr, offset = 1) => arr[arr.length - offset];
    const variableDescriptors = new WeakMap();
    const defineVariableInternal = (scope, name, tdz, immutable) => {
        if (!variableDescriptors.has(scope)) {
            variableDescriptors.set(scope, new Map());
        }
        const descriptor = {
            [9 /* tdz */]: tdz,
            [10 /* immutable */]: immutable,
            [11 /* value */]: undefined
        };
        variableDescriptors.get(scope).set(name, descriptor);
        Reflect.defineProperty(scope, name, {
            configurable: true,
            get() {
                if (descriptor[9 /* tdz */]) {
                    throw new ReferenceError(name + is_not_defined);
                }
                return descriptor[11 /* value */];
            },
            set(v) {
                if (descriptor[9 /* tdz */]) {
                    throw new ReferenceError(name + is_not_defined);
                }
                if (descriptor[10 /* immutable */]) {
                    throw new TypeError(name + is_a_constant);
                }
                descriptor[11 /* value */] = v;
            }
        });
    };
    const defineVariable = (scope, name, type) => {
        switch (type) {
            case 3 /* Const */:
                // seal it later
                return defineVariableInternal(scope, name, true, false);
            case 2 /* Let */:
                return defineVariableInternal(scope, name, true, false);
            case 5 /* Function */:
            case 4 /* Parameter */:
            case 1 /* Var */:
                //don't have tdz
                return defineVariableInternal(scope, name, false, false);
        }
    };
    const getVariableDescriptor = (scope, name) => {
        const map = variableDescriptors.get(scope);
        if (map) {
            return map.get(name);
        }
    };
    const functionDescriptors = new WeakMap();
    const MyArgument = function MyArgument() { };
    const createArgumentObject = () => {
        const obj = new MyArgument();
        Reflect.setPrototypeOf(obj, Object.prototype);
        return obj;
    };
    const defineFunction = (scopes, name, type, offset) => {
        // TODO: types
        const scopeClone = [...scopes];
        const des = {
            [8 /* name */]: name,
            [0 /* type */]: type,
            [12 /* offset */]: offset,
            [2 /* scopes */]: scopeClone
        };
        const fn = function (...args) {
            return run(program, textData, offset, [...scopeClone], this, args);
        };
        functionDescriptors.set(fn, des);
        return fn;
    };
    const bindInfo = new WeakMap();
    const bindInternal = (fn, self, args) => {
        if (typeof fn !== 'function') {
            return undefined;
        }
        const bindFn = function (...additionalArgs) {
            return Reflect.apply(fn, self, [...args, ...additionalArgs]);
        };
        bindInfo.set(bindFn, {
            [16 /* function */]: fn,
            [17 /* self */]: self,
            [18 /* arguments */]: args
        });
        return bindFn;
    };
    const findScope = (ctx, name) => {
        for (let i = ctx[2 /* scopes */].length - 1; i >= 0; i--) {
            if (Reflect.has(ctx[2 /* scopes */][i], name)) {
                return ctx[2 /* scopes */][i];
            }
        }
        return null;
    };
    const getValue = (ctx, name) => {
        if (!environments.has(ctx)) {
            return ctx[name];
        }
        else {
            const env = ctx;
            const scope = findScope(env, name);
            if (scope) {
                return scope[name];
            }
            else {
                throw new ReferenceError(name + is_not_defined);
            }
        }
    };
    const setValue = (ctx, name, value) => {
        if (!environments.has(ctx)) {
            return (ctx[name] = value);
        }
        else {
            const env = ctx;
            const scope = findScope(env, name);
            if (scope) {
                return (scope[name] = value);
            }
            else {
                throw new ReferenceError(name + is_not_defined);
            }
        }
    };
    while (ptr >= 0 && ptr < program.length) {
        const currentPtr = ptr;
        const command = read();
        const currentFrame = getCurrentFrame();
        const addCatchScope = (frame, name, value) => {
            const newScope = {};
            defineVariable(newScope, name, 1 /* Var */);
            newScope[name] = value;
            frame[2 /* scopes */].push(newScope);
        };
        const returnsValueConditional = (value) => {
            const currentFrame = peak(stack);
            // try to find upper try frame or return (if any and hand control to it)
            switch (currentFrame[0 /* type */]) {
                case 0 /* Function */:
                    {
                        const frame = currentFrame;
                        // exit
                        const returnAddr = frame[4 /* return */];
                        if (returnAddr < 0) {
                            // leave the whole function
                            return value;
                        }
                        else {
                            stack.pop();
                            ptr = returnAddr;
                            if (frame[19 /* invokeType */] === 0 /* Apply */
                                || (value !== null && typeof value === 'object')
                                || typeof value === 'function') {
                                peak(stack)[3 /* valueStack */].push(value);
                            }
                            else {
                                peak(stack)[3 /* valueStack */].push(getValue(frame, "[this]" /* This */));
                            }
                        }
                    }
                    break;
                case 1 /* Try */:
                    {
                        const frame = currentFrame;
                        // as if we return on upper try catch
                        frame[3 /* valueStack */].push(value);
                        returnsTryFrame();
                    }
                    break;
            }
        };
        const returnsTryFrame = () => {
            const frame = peak(stack);
            const value = frame[3 /* valueStack */].pop();
            const finallyAddr = frame[6 /* finally */];
            // restore scopes
            frame[2 /* scopes */] = frame[1 /* savedScopes */].slice(0);
            const state = frame[13 /* state */];
            switch (state) {
                case 0 /* Try */:
                case 1 /* Catch */:
                    {
                        if (finallyAddr >= 0) {
                            frame[13 /* state */] = 2 /* Finally */;
                            frame[14 /* resolveType */] = 2 /* return */;
                            frame[11 /* value */] = value;
                            ptr = finallyAddr;
                        }
                        else {
                            stack.pop();
                            returnsValueConditional(value);
                            return;
                        }
                    }
                    break;
                case 2 /* Finally */:
                    {
                        stack.pop();
                        returnsValueConditional(value);
                        return;
                    }
                    break;
                default:
                    const nothing = state;
            }
        };
        const throwsConditional = (value) => {
            loop: while (true) {
                if (stack.length === 0) {
                    throw value;
                }
                const currentFrame = peak(stack);
                switch (currentFrame[0 /* type */]) {
                    case 0 /* Function */:
                        {
                            stack.pop();
                        }
                        break;
                    case 1 /* Try */: {
                        const frame = currentFrame;
                        if (frame[13 /* state */] === 2 /* Finally */) {
                            stack.pop();
                        }
                        else {
                            // as if we return on upper try catch
                            currentFrame[3 /* valueStack */].push(value);
                            throwsTryFrame();
                            return;
                        }
                    }
                }
            }
            throw value;
        };
        const throwsTryFrame = () => {
            const frame = peak(stack);
            const value = frame[3 /* valueStack */].pop();
            const exitAddr = frame[15 /* exit */];
            const finallyAddr = frame[6 /* finally */];
            const catchAddr = frame[5 /* catch */];
            // restore scopes
            frame[2 /* scopes */] = frame[1 /* savedScopes */].slice(0);
            const state = frame[13 /* state */];
            switch (state) {
                case 0 /* Try */:
                    {
                        if (catchAddr >= 0) {
                            frame[13 /* state */] = 1 /* Catch */;
                            frame[14 /* resolveType */] = 1 /* throw */;
                            frame[11 /* value */] = value;
                            if (frame[7 /* variable */] !== undefined) {
                                addCatchScope(frame, frame[7 /* variable */], value);
                            }
                            ptr = catchAddr;
                        }
                        else {
                            ptr = exitAddr;
                        }
                    }
                    break;
                case 1 /* Catch */: {
                    if (finallyAddr >= 0) {
                        frame[13 /* state */] = 2 /* Finally */;
                        frame[14 /* resolveType */] = 1 /* throw */;
                        frame[11 /* value */] = value;
                        ptr = finallyAddr;
                    }
                    else {
                        stack.pop();
                        throwsConditional(value);
                    }
                    break;
                }
                case 2 /* Finally */:
                    {
                        stack.pop();
                        throwsConditional(value);
                    }
                    break;
                default:
                    const nothing = state;
            }
        };
        try {
            command: switch (command) {
                case 1 /* Literal */:
                    {
                        const value = read();
                        if (isSmallNumber(value)) {
                            currentFrame[3 /* valueStack */].push(value);
                        }
                        else {
                            currentFrame[3 /* valueStack */].push(textData[value ^ TEXT_DADA_MASK]);
                        }
                    }
                    break;
                case 14 /* Pop */:
                    currentFrame[3 /* valueStack */].pop();
                    break;
                case 15 /* Duplicate */:
                    currentFrame[3 /* valueStack */].push(peak(currentFrame[3 /* valueStack */]));
                    break;
                case 16 /* GetRecord */:
                    currentFrame[3 /* valueStack */].push(currentFrame);
                    break;
                case 2 /* NullLiteral */:
                    currentFrame[3 /* valueStack */].push(null);
                    break;
                case 3 /* UndefinedLiteral */:
                    currentFrame[3 /* valueStack */].push(undefined);
                    break;
                case 43 /* RegexpLiteral */:
                    {
                        const flags = currentFrame[3 /* valueStack */].pop();
                        const source = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(new REGEXP(source, flags));
                    }
                    break;
                case 17 /* Set */:
                case 18 /* SetKeepCtx */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        if (!environments.has(ctx)) {
                            ctx[name] = value;
                        }
                        else {
                            const scope = findScope(ctx, name);
                            if (scope) {
                                scope[name] = value;
                            }
                            else {
                                throw new ReferenceError(name + is_not_defined);
                            }
                        }
                        if (command === 17 /* Set */) {
                            currentFrame[3 /* valueStack */].push(value);
                        }
                        else /* if (command === OpCode.SetKeepCtx) */ {
                            currentFrame[3 /* valueStack */].push(ctx);
                        }
                    }
                    break;
                // Assign and update
                case 64 /* BPlusEqual */:
                case 65 /* BMinusEqual */:
                case 66 /* BSlashEqual */:
                case 67 /* BAsteriskEqual */:
                    {
                        const rightVal = currentFrame[3 /* valueStack */].pop();
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        const leftValue = getValue(ctx, name);
                        const commandCurrent = command;
                        const exprs = {
                            [64 /* BPlusEqual */]: (a, b) => a + b,
                            [65 /* BMinusEqual */]: (a, b) => a - b,
                            [66 /* BSlashEqual */]: (a, b) => a / b,
                            [67 /* BAsteriskEqual */]: (a, b) => a * b
                        };
                        const r = exprs[command](leftValue, rightVal);
                        setValue(ctx, name, r);
                        currentFrame[3 /* valueStack */].push(r);
                    }
                    break;
                case 20 /* DefineKeepCtx */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        Reflect.defineProperty(ctx, name, {
                            configurable: true,
                            enumerable: true,
                            writable: true,
                            value: value
                        });
                        ctx[name] = value;
                        currentFrame[3 /* valueStack */].push(ctx);
                    }
                    break;
                case 21 /* Get */:
                    {
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(getValue(ctx, name));
                    }
                    break;
                case 19 /* SetMultiple */:
                    {
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        const length = currentFrame[3 /* valueStack */].pop();
                        for (let i = 0; i < length; i++) {
                            const flag = currentFrame[3 /* valueStack */].pop();
                            const value = currentFrame[3 /* valueStack */].pop();
                            const name = currentFrame[3 /* valueStack */].pop();
                            let hit = false;
                            for (let i = ctx[2 /* scopes */].length - 1; i >= 0; i--) {
                                if (Reflect.has(ctx[2 /* scopes */][i], name)) {
                                    hit = true;
                                    const desc = getVariableDescriptor(ctx[2 /* scopes */][i], name);
                                    if (desc && (flag & 1 /* DeTDZ */))
                                        desc[9 /* tdz */] = false;
                                    currentFrame[2 /* scopes */][i][name] = value;
                                    if (desc && (flag & 2 /* Freeze */))
                                        desc[10 /* immutable */] = true;
                                    break;
                                }
                            }
                            if (!hit) {
                                throw new ReferenceError(name + is_not_defined);
                            }
                        }
                    }
                    break;
                case 8 /* Jump */:
                    {
                        const pos = currentFrame[3 /* valueStack */].pop();
                        ptr = pos;
                    }
                    break;
                case 6 /* JumpIfNot */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const pos = currentFrame[3 /* valueStack */].pop();
                        if (value) {
                            // intentional blank
                        }
                        else {
                            ptr = pos;
                        }
                    }
                    break;
                case 7 /* JumpIf */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const pos = currentFrame[3 /* valueStack */].pop();
                        if (value) {
                            ptr = pos;
                        }
                        else {
                            // intentional blank
                        }
                    }
                    break;
                case 9 /* JumpIfAndKeep */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const pos = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(value);
                        if (value) {
                            ptr = pos;
                        }
                        else {
                            // intentional blank
                        }
                    }
                    break;
                case 10 /* JumpIfNotAndKeep */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const pos = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(value);
                        if (value) {
                            // intentional blank
                        }
                        else {
                            ptr = pos;
                        }
                    }
                    break;
                case 11 /* EnterFunction */:
                    {
                        // TODO: arguments and this/self reference
                        const functionType = currentFrame[3 /* valueStack */].pop();
                        const variableCount = currentFrame[3 /* valueStack */].pop();
                        const variables = [];
                        for (let i = 0; i < variableCount; i++) {
                            variables.push({
                                [0 /* type */]: currentFrame[3 /* valueStack */].pop(),
                                [8 /* name */]: currentFrame[3 /* valueStack */].pop()
                            });
                        }
                        const argumentNameCount = currentFrame[3 /* valueStack */].pop();
                        const argumentNames = [];
                        for (let i = 0; i < argumentNameCount; i++) {
                            argumentNames.push(currentFrame[3 /* valueStack */].pop());
                        }
                        const parameterCount = currentFrame[3 /* valueStack */].pop();
                        const parameters = [];
                        for (let i = 0; i < parameterCount; i++) {
                            parameters.unshift(currentFrame[3 /* valueStack */].pop());
                        }
                        const invokeType = currentFrame[3 /* valueStack */].pop();
                        const getArgumentObject = (scope, callee) => {
                            const obj = createArgumentObject();
                            const bindingLength = Math.min(argumentNameCount, parameterCount);
                            for (let i = 0; i < parameterCount; i++) {
                                if (i < bindingLength) {
                                    Object.defineProperty(obj, i, {
                                        enumerable: true,
                                        configurable: true,
                                        get() {
                                            return scope[argumentNames[i]];
                                        },
                                        set(v) {
                                            scope[argumentNames[i]] = v;
                                        }
                                    });
                                }
                                else {
                                    obj[i] = parameters[i];
                                }
                            }
                            Object.defineProperty(obj, 'length', {
                                enumerable: false,
                                configurable: true,
                                value: parameterCount
                            });
                            Object.defineProperty(obj, 'callee', {
                                enumerable: false,
                                configurable: true,
                                value: callee
                            });
                            return obj;
                        };
                        if (invokeType === 0 /* Apply */) {
                            // TODO: arguments and this/self reference
                            const name = currentFrame[3 /* valueStack */].pop();
                            const fn = currentFrame[3 /* valueStack */].pop();
                            const self = currentFrame[3 /* valueStack */].pop();
                            const scope = {};
                            currentFrame[2 /* scopes */].push(scope);
                            switch (functionType) {
                                case 1 /* FunctionDeclaration */:
                                case 2 /* FunctionExpression */:
                                case 4 /* MethodDeclaration */:
                                case 5 /* GetAccessor */:
                                case 6 /* SetAccessor */:
                                    defineVariable(scope, "[this]" /* This */, 1 /* Var */);
                                    scope["[this]" /* This */] = self;
                                    scope['arguments'] = getArgumentObject(scope, fn);
                            }
                            switch (functionType) {
                                case 2 /* FunctionExpression */:
                                case 4 /* MethodDeclaration */:
                                    scope[name] = fn;
                            }
                            for (let v of variables) {
                                defineVariable(scope, v[8 /* name */], v[0 /* type */]);
                            }
                            for (let [index, name] of argumentNames.entries()) {
                                scope[name] = parameters[index];
                            }
                        }
                        else if (invokeType === 1 /* Construct */) {
                            const name = currentFrame[3 /* valueStack */].pop();
                            const fn = currentFrame[3 /* valueStack */].pop();
                            const newTarget = currentFrame[3 /* valueStack */].pop();
                            const scope = {};
                            currentFrame[2 /* scopes */].push(scope);
                            switch (functionType) {
                                case 4 /* MethodDeclaration */:
                                case 5 /* GetAccessor */:
                                case 6 /* SetAccessor */:
                                    throw new TypeError('- not a constructor');
                                case 1 /* FunctionDeclaration */:
                                case 2 /* FunctionExpression */:
                                    defineVariable(scope, "[this]" /* This */, 1 /* Var */);
                                    scope["[this]" /* This */] = Object.create(fn.prototype);
                                    scope['arguments'] = getArgumentObject(scope, fn);
                            }
                            switch (functionType) {
                                case 2 /* FunctionExpression */:
                                    scope[name] = fn;
                            }
                            for (let v of variables) {
                                defineVariable(scope, v[8 /* name */], v[0 /* type */]);
                            }
                            for (let [index, name] of argumentNames.entries()) {
                                scope[name] = parameters[index];
                            }
                        }
                    }
                    break;
                case 12 /* EnterScope */:
                    {
                        const variableCount = currentFrame[3 /* valueStack */].pop();
                        const variables = [];
                        for (let i = 0; i < variableCount; i++) {
                            variables.push({
                                [0 /* type */]: currentFrame[3 /* valueStack */].pop(),
                                [8 /* name */]: currentFrame[3 /* valueStack */].pop()
                            });
                        }
                        const scope = {};
                        currentFrame[2 /* scopes */].push(scope);
                        for (let v of variables) {
                            defineVariable(scope, v[8 /* name */], v[0 /* type */]);
                        }
                    }
                    break;
                case 13 /* LeaveScope */:
                    {
                        currentFrame[2 /* scopes */].pop();
                    }
                    break;
                case 22 /* DeTDZ */:
                    {
                        const env = peak(currentFrame[3 /* valueStack */], 2);
                        const name = peak(currentFrame[3 /* valueStack */]);
                        getVariableDescriptor(peak(env[2 /* scopes */]), name)[9 /* tdz */] = false;
                    }
                    break;
                case 23 /* FreezeVariable */:
                    {
                        const env = peak(currentFrame[3 /* valueStack */], 2);
                        const name = peak(currentFrame[3 /* valueStack */]);
                        getVariableDescriptor(peak(env[2 /* scopes */]), name)[10 /* immutable */] = true;
                    }
                    break;
                case 24 /* DefineFunction */:
                    {
                        const type = currentFrame[3 /* valueStack */].pop();
                        const offset = currentFrame[3 /* valueStack */].pop();
                        const name = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(defineFunction(currentFrame[2 /* scopes */], name, type, offset));
                    }
                    break;
                case 33 /* CallValue */:
                case 31 /* Call */:
                    {
                        const parameterCount = currentFrame[3 /* valueStack */].pop();
                        let parameters = [];
                        for (let i = 0; i < parameterCount; i++) {
                            parameters.unshift(currentFrame[3 /* valueStack */].pop());
                        }
                        let fn, envOrRecord, name = '';
                        if (command === 31 /* Call */) {
                            name = currentFrame[3 /* valueStack */].pop();
                            envOrRecord = currentFrame[3 /* valueStack */].pop();
                            fn = getValue(envOrRecord, name);
                        }
                        else /** if (command === OpCode.CallValue) */ {
                            envOrRecord = undefined;
                            fn = currentFrame[3 /* valueStack */].pop();
                        }
                        while (fn === CALL || fn === APPLY || bindInfo.has(fn)) {
                            let newFn, newSelf, newParameters;
                            if (fn === CALL) {
                                newFn = envOrRecord;
                                newSelf = parameters[0];
                                newParameters = parameters.slice(1);
                            }
                            else if (fn === APPLY) {
                                newFn = envOrRecord;
                                newSelf = parameters[0];
                                const parameterArrayLike = parameters != null ? parameters[1] : [];
                                const parameterLength = parameterArrayLike.length;
                                newParameters = [];
                                for (let i = 0; i < parameterLength; i++) {
                                    newParameters.push(parameterArrayLike[i]);
                                }
                            }
                            else /* if (bindInfo.has(fn))*/ {
                                const info0 = bindInfo.get(fn);
                                const info = info0;
                                newSelf = info[17 /* self */];
                                newParameters = [...info[18 /* arguments */], ...parameters];
                                newFn = info[16 /* function */];
                            }
                            fn = environments.has(newFn) ? undefined : newFn;
                            envOrRecord = newSelf;
                            parameters = newParameters;
                        }
                        let self = undefined;
                        if (!environments.has(envOrRecord)) {
                            self = envOrRecord;
                        }
                        if (fn === BIND) {
                            const bound = bindInternal(self, parameters[0], parameters.slice(1));
                            currentFrame[3 /* valueStack */].push(bound);
                        }
                        else if (!functionDescriptors.has(fn)) {
                            // extern
                            if (typeof fn !== 'function') {
                                if (command === 31 /* Call */) {
                                    throw new TypeError(`(intermediate value).${name} is not a function`);
                                }
                                else /* if (command === OpCode.CallValue) */ {
                                    throw new TypeError(`(intermediate value) is not a function`);
                                }
                            }
                            else {
                                currentFrame[3 /* valueStack */].push(Reflect.apply(fn, self, parameters));
                            }
                        }
                        else {
                            const des = functionDescriptors.get(fn);
                            const newFrame = {
                                [0 /* type */]: 0 /* Function */,
                                [2 /* scopes */]: [...des[2 /* scopes */]],
                                [4 /* return */]: ptr,
                                [3 /* valueStack */]: [
                                    self,
                                    fn,
                                    des[8 /* name */],
                                    0 /* Apply */,
                                    ...parameters,
                                    parameters.length
                                ],
                                [19 /* invokeType */]: 0 /* Apply */
                            };
                            environments.add(newFrame);
                            stack.push(newFrame);
                            ptr = des[12 /* offset */];
                        }
                    }
                    break;
                case 32 /* New */:
                    {
                        const parameterCount = currentFrame[3 /* valueStack */].pop();
                        let parameters = [];
                        for (let i = 0; i < parameterCount; i++) {
                            parameters.unshift(currentFrame[3 /* valueStack */].pop());
                        }
                        let fn = currentFrame[3 /* valueStack */].pop();
                        while (bindInfo.has(fn)) {
                            let newFn, newParameters;
                            const info0 = bindInfo.get(fn);
                            const info = info0;
                            newParameters = [...info[18 /* arguments */], ...parameters];
                            newFn = info[16 /* function */];
                            fn = environments.has(newFn) ? undefined : newFn;
                            parameters = newParameters;
                        }
                        if (!functionDescriptors.has(fn)) {
                            // extern
                            currentFrame[3 /* valueStack */].push(Reflect.construct(fn, parameters, fn));
                        }
                        else {
                            const des = functionDescriptors.get(fn);
                            const newFrame = {
                                [0 /* type */]: 0 /* Function */,
                                [2 /* scopes */]: [...des[2 /* scopes */]],
                                [4 /* return */]: ptr,
                                [3 /* valueStack */]: [
                                    fn,
                                    fn,
                                    des[8 /* name */],
                                    1 /* Construct */,
                                    ...parameters,
                                    parameters.length
                                ],
                                [19 /* invokeType */]: 1 /* Construct */
                            };
                            environments.add(newFrame);
                            stack.push(newFrame);
                            ptr = des[12 /* offset */];
                        }
                    }
                    break;
                case 25 /* Return */:
                    {
                        const result = currentFrame[3 /* valueStack */].pop();
                        if (currentFrame[3 /* valueStack */].length > 0) {
                            throw new Error('bad return');
                        }
                        // remove all try frames
                        while (peak(stack)[0 /* type */] !== 0 /* Function */) {
                            stack.pop();
                        }
                        const returnAddr = peak(stack)[4 /* return */];
                        const functionFrame = peak(stack);
                        if (returnAddr < 0) {
                            // leave the whole function
                            if (functionFrame[19 /* invokeType */] === 0 /* Apply */) {
                                return result;
                            }
                            else {
                                if (typeof result === 'function' || typeof result === 'object') {
                                    return result;
                                }
                                else {
                                    return getValue(functionFrame, "[this]" /* This */);
                                }
                            }
                        }
                        stack.pop();
                        if (functionFrame[19 /* invokeType */] === 0 /* Apply */) {
                            peak(stack)[3 /* valueStack */].push(result);
                        }
                        else {
                            if (typeof result === 'function' || typeof result === 'object') {
                                peak(stack)[3 /* valueStack */].push(result);
                            }
                            else {
                                peak(stack)[3 /* valueStack */].push(getValue(functionFrame, "[this]" /* This */));
                            }
                        }
                        ptr = returnAddr;
                    }
                    break;
                case 27 /* Throw */: {
                    const err = currentFrame[3 /* valueStack */].pop();
                    throw err;
                }
                case 69 /* ThrowReferenceError */: {
                    const msg = currentFrame[3 /* valueStack */].pop();
                    throw new ReferenceError(msg);
                }
                case 41 /* ArrayLiteral */:
                    currentFrame[3 /* valueStack */].push([]);
                    break;
                case 42 /* ObjectLiteral */:
                    currentFrame[3 /* valueStack */].push({});
                    break;
                case 30 /* InitTryCatch */:
                    {
                        const catchName = currentFrame[3 /* valueStack */].pop();
                        const finallyAddr = currentFrame[3 /* valueStack */].pop();
                        const catchAddr = currentFrame[3 /* valueStack */].pop();
                        const exitAddr = currentFrame[3 /* valueStack */].pop();
                        const frame = {
                            [0 /* type */]: 1 /* Try */,
                            [1 /* savedScopes */]: currentFrame[2 /* scopes */],
                            [2 /* scopes */]: currentFrame[2 /* scopes */].slice(0),
                            [3 /* valueStack */]: [],
                            [13 /* state */]: 0 /* Try */,
                            [14 /* resolveType */]: 0 /* normal */,
                            [11 /* value */]: undefined,
                            [5 /* catch */]: catchAddr,
                            [6 /* finally */]: finallyAddr,
                            [7 /* variable */]: catchName,
                            [15 /* exit */]: exitAddr
                        };
                        environments.add(frame);
                        stack.push(frame);
                    }
                    break;
                case 26 /* ReturnInTryCatchFinally */:
                    returnsTryFrame();
                    break;
                case 28 /* ThrowInTryCatchFinally */:
                    throwsTryFrame();
                    break;
                case 29 /* ExitTryCatchFinally */:
                    {
                        const frame = currentFrame;
                        const prevState = frame[13 /* state */];
                        const prevResolveType = frame[14 /* resolveType */];
                        const prevValue = frame[11 /* value */];
                        const exit = frame[15 /* exit */];
                        const finallyPtr = frame[6 /* finally */];
                        // restore scopes
                        frame[2 /* scopes */] = frame[1 /* savedScopes */].slice(0);
                        switch (prevState) {
                            case 2 /* Finally */:
                                switch (prevResolveType) {
                                    case 0 /* normal */:
                                        ptr = exit;
                                        break command;
                                    case 1 /* throw */:
                                        throwsConditional(prevValue);
                                        break command;
                                    case 2 /* return */:
                                        returnsValueConditional(prevValue);
                                        break command;
                                }
                            case 0 /* Try */:
                            case 1 /* Catch */:
                                if (frame[6 /* finally */] >= 0) {
                                    frame[13 /* state */] = 2 /* Finally */;
                                    frame[14 /* resolveType */] = 0 /* normal */;
                                    frame[11 /* value */] = undefined;
                                    ptr = finallyPtr;
                                    break command;
                                }
                                else {
                                    ptr = exit;
                                    break command;
                                }
                            default:
                                const nothing = prevState;
                        }
                    }
                    break;
                case 34 /* Typeof */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(typeof value);
                    }
                    break;
                case 35 /* TypeofReference */:
                    {
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        if (environments.has(ctx)) {
                            const frame = ctx;
                            for (let i = frame[2 /* scopes */].length - 1; i >= 0; i--) {
                                if (Reflect.getOwnPropertyDescriptor(frame[2 /* scopes */][i], name)) {
                                    currentFrame[3 /* valueStack */].push(typeof frame[2 /* scopes */][i][name]);
                                    break command;
                                }
                            }
                            currentFrame[3 /* valueStack */].push('undefined');
                        }
                        else {
                            currentFrame[3 /* valueStack */].push(typeof ctx[name]);
                        }
                    }
                    break;
                case 37 /* GetPropertyIterator */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        const iterator = (function* (value) {
                            for (const key in value) {
                                yield key;
                            }
                        })(value);
                        currentFrame[3 /* valueStack */].push(iterator);
                    }
                    break;
                case 38 /* NextEntry */:
                    {
                        const iterator = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(iterator.next());
                    }
                    break;
                case 39 /* EntryIsDone */:
                    {
                        const entry = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(entry.done);
                    }
                    break;
                case 40 /* EntryGetValue */:
                    {
                        const entry = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(entry.value);
                    }
                    break;
                case 36 /* InstanceOf */:
                case 48 /* BAmpersand */:
                case 49 /* BBar */:
                case 47 /* BCaret */:
                case 57 /* BEqualsEquals */:
                case 58 /* BEqualsEqualsEquals */:
                case 50 /* BGreaterThan */:
                case 51 /* BGreaterThanGreaterThan */:
                case 52 /* BGreaterThanGreaterThanGreaterThan */:
                case 53 /* BGreaterThanEquals */:
                case 54 /* BLessThan */:
                case 55 /* BLessThanLessThan */:
                case 56 /* BLessThanEquals */:
                case 57 /* BEqualsEquals */:
                case 58 /* BEqualsEqualsEquals */:
                case 59 /* BExclamationEquals */:
                case 60 /* BExclamationEqualsEquals */:
                case 46 /* BMinus */:
                case 45 /* BPlus */:
                case 44 /* BIn */:
                case 61 /* BAsterisk */:
                case 62 /* BSlash */:
                case 63 /* BPercent */:
                    {
                        const right = currentFrame[3 /* valueStack */].pop();
                        const left = currentFrame[3 /* valueStack */].pop();
                        const ops = {
                            [48 /* BAmpersand */]: (left, right) => left & right,
                            [49 /* BBar */]: (left, right) => left | right,
                            [47 /* BCaret */]: (left, right) => left ^ right,
                            [57 /* BEqualsEquals */]: (left, right) => left == right,
                            [58 /* BEqualsEqualsEquals */]: (left, right) => left === right,
                            [59 /* BExclamationEquals */]: (left, right) => left != right,
                            [60 /* BExclamationEqualsEquals */]: (left, right) => left !== right,
                            [50 /* BGreaterThan */]: (left, right) => left > right,
                            [51 /* BGreaterThanGreaterThan */]: (left, right) => left >> right,
                            [52 /* BGreaterThanGreaterThanGreaterThan */]: (left, right) => left >>> right,
                            [53 /* BGreaterThanEquals */]: (left, right) => left >= right,
                            [54 /* BLessThan */]: (left, right) => left < right,
                            [55 /* BLessThanLessThan */]: (left, right) => left << right,
                            [56 /* BLessThanEquals */]: (left, right) => left <= right,
                            [45 /* BPlus */]: (left, right) => left + right,
                            [46 /* BMinus */]: (left, right) => left - right,
                            [36 /* InstanceOf */]: (left, right) => left instanceof right,
                            [44 /* BIn */]: (left, right) => left in right,
                            [61 /* BAsterisk */]: (left, right) => left * right,
                            [62 /* BSlash */]: (left, right) => left / right,
                            [63 /* BPercent */]: (left, right) => left % right
                        };
                        const result = ops[command](left, right);
                        currentFrame[3 /* valueStack */].push(result);
                    }
                    break;
                case 71 /* PostFixPlusPLus */:
                case 70 /* PostFixMinusMinus */:
                    {
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        if (environments.has(ctx)) {
                            const env = ctx;
                            const scope = findScope(env, name);
                            if (scope) {
                                const old = scope[name];
                                const newVal = command === 71 /* PostFixPlusPLus */ ? old + 1 : old - 1;
                                scope[name] = newVal;
                                currentFrame[3 /* valueStack */].push(old);
                            }
                            else {
                                throw new ReferenceError(name + is_not_defined);
                            }
                        }
                        else {
                            const self = ctx;
                            const old = self[name];
                            const newVal = command === 71 /* PostFixPlusPLus */ ? old + 1 : old - 1;
                            self[name] = newVal;
                            currentFrame[3 /* valueStack */].push(old);
                        }
                    }
                    break;
                case 72 /* PrefixUnaryPlus */:
                case 73 /* PrefixUnaryMinus */:
                case 74 /* PrefixExclamation */:
                case 75 /* PrefixTilde */:
                    {
                        const value = currentFrame[3 /* valueStack */].pop();
                        let result;
                        switch (command) {
                            case 72 /* PrefixUnaryPlus */:
                                result = +value;
                                break;
                            case 73 /* PrefixUnaryMinus */:
                                result = -value;
                                break;
                            case 74 /* PrefixExclamation */:
                                result = !value;
                                break;
                            case 75 /* PrefixTilde */:
                                result = ~value;
                                break;
                        }
                        currentFrame[3 /* valueStack */].push(result);
                    }
                    break;
                // Prefix updates
                case 76 /* PrefixPlusPlus */:
                case 77 /* PrefixMinusMinus */:
                    {
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        const currentValue = getValue(ctx, name);
                        const newVal = command === 76 /* PrefixPlusPlus */ ? currentValue + 1 : currentValue - 1;
                        setValue(ctx, name, newVal);
                        // Just don't care and push the new value
                        currentFrame[3 /* valueStack */].push(newVal);
                    }
                    break;
                case 68 /* Delete */:
                    {
                        const name = currentFrame[3 /* valueStack */].pop();
                        const ctx = currentFrame[3 /* valueStack */].pop();
                        currentFrame[3 /* valueStack */].push(delete ctx[name]);
                    }
                    break;
                case 78 /* Debugger */:
                    debugger;
                    break;
                default:
                    const nothing = command;
                    throw new Error('Um?');
            }
        }
        catch (err) {
            if (err != null && typeof err === 'object') {
                err.pos = currentPtr;
            }
            throwsConditional(err);
        }
    }
}
const textData = ["fetch","./jquery.json","then","","t","json","_$_","Int32Array","Uint8Array","from","atob","p","buffer","globalThis","./bad-code.json","charCodeAt"]
const programData = new Int32Array(Uint8Array.from(atob('AQAAAAAAAAABAAAAAAAAAAEAAAAAAAAACwAAABAAAAABAAAAAAAAgAEAAAABAACAAQAAAAEAAAAfAAAAAQAAAAIAAIABAAAAAwAAgAEAAAAqAAAAAQAAAAMAAAAYAAAAAQAAAAEAAAAfAAAAAQAAAAIAAIABAAAAAwAAgAEAAABBAAAAAQAAAAMAAAAYAAAAAQAAAAEAAAAfAAAADgAAAAMAAAAZAAAAAQAAAAQAAIABAAAAAQAAAAEAAAAEAACAAQAAAAQAAAABAAAAAQAAAAEAAAADAAAACwAAABAAAAABAAAABAAAgBUAAAABAAAABQAAgAEAAAAAAAAAHwAAABkAAAABAAAABAAAgAEAAAABAAAAAQAAAAQAAIABAAAABAAAAAEAAAABAAAAAQAAAAMAAAALAAAAEAAAAAEAAAAGAACAEAAAAAEAAAAHAACAFQAAABAAAAABAAAACAAAgBUAAAABAAAACQAAgBAAAAABAAAACgAAgBAAAAABAAAABAAAgBUAAAABAAAACwAAgBUAAAABAAAAAQAAAB8AAAABAAAAAwAAgAEAAAC7AAAAAQAAAAMAAAAYAAAAAQAAAAIAAAAfAAAAAQAAAAwAAIAVAAAAAQAAAAEAAAAgAAAAEAAAAAEAAAAEAACAFQAAAAEAAAAEAACAFQAAAAEAAAAAAAAAKQAAAAEAAAAAAAAAEAAAAAEAAAANAACAFQAAABIAAAABAAAAAQAAACoAAAABAAAABgAAgBAAAAABAAAABgAAgBUAAAAUAAAAEgAAAAEAAAAEAAAAHwAAAA4AAAAQAAAAAQAAAAAAAIABAAAADgAAgAEAAAABAAAAHwAAAAEAAAACAACAAQAAAAMAAIABAAAA1AAAAAEAAAADAAAAGAAAAAEAAAABAAAAHwAAAAEAAAACAACAAQAAAAMAAIABAAAA6wAAAAEAAAADAAAAGAAAAAEAAAABAAAAHwAAAA4AAAADAAAAGQAAAAEAAAAEAACAAQAAAAEAAAABAAAABAAAgAEAAAAEAAAAAQAAAAEAAAABAAAAAwAAAAsAAAAQAAAAAQAAAAQAAIAVAAAAAQAAAA8AAIABAAAAAAAAAAEAAAABAAAAHwAAABkAAAABAAAABAAAgAEAAAABAAAAAQAAAAQAAIABAAAABAAAAAEAAAABAAAAAQAAAAMAAAALAAAAEAAAAAEAAAAEAACAFQAAAAEAAAAFAACAAQAAAAAAAAAfAAAAGQAAAAEAAAAEAACAAQAAAAEAAAABAAAABAAAgAEAAAAEAAAAAQAAAAEAAAABAAAAAwAAAAsAAAAQAAAAAQAAAAYAAIAQAAAAAQAAAAcAAIAVAAAAEAAAAAEAAAAIAACAFQAAAAEAAAAJAACAEAAAAAEAAAAKAACAEAAAAAEAAAAEAACAFQAAAAEAAAALAACAFQAAAAEAAAABAAAAHwAAAAEAAAADAACAAQAAAEIBAAABAAAAAwAAABgAAAABAAAAAgAAAB8AAAABAAAADAAAgBUAAAABAAAAAQAAACAAAAAQAAAAAQAAAAQAAIAVAAAAAQAAAAQAAIAVAAAAAQAAAAAAAAApAAAAAQAAAAAAAAAQAAAAAQAAAA0AAIAVAAAAEgAAAAEAAAABAAAAKgAAAAEAAAAGAACAEAAAAAEAAAAGAACAFQAAABQAAAASAAAAAQAAAAQAAAAfAAAAGQAAAAEAAAAEAACAAQAAAAEAAAABAAAABAAAgAEAAAAEAAAAAQAAAAEAAAABAAAAAwAAAAsAAAAQAAAAAQAAAAQAAIAVAAAAAQAAAA8AAIABAAAAAAAAAAEAAAABAAAAHwAAABkAAAA='), c => c.charCodeAt(0)).buffer)
run(programData, textData, 0, [globalThis, { _$_: run }])
    }

