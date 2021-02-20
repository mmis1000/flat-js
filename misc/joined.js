{
    // MUST SYNC WITH COMPILER
    const TEXT_DADA_MASK = 0x80000000;
    // MUST SYNC WITH COMPILER
    const isSmallNumber = (a) => {
        return typeof a === 'number' && ((a | 0) === a) && ((a & TEXT_DADA_MASK) === 0);
    };
    function run(program, textData, entryPoint = 0, scopes = [], self = undefined, args = []) {
        const environments = new WeakSet();
        const initialFrame = {
            [0 /* type */]: 0 /* Function */,
            [1 /* scopes */]: scopes,
            [2 /* valueStack */]: [
                self,
                ...args,
                args.length
            ],
            [3 /* return */]: -1
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
                [7 /* tdz */]: tdz,
                [8 /* immutable */]: immutable,
                [9 /* value */]: undefined
            };
            variableDescriptors.get(scope).set(name, descriptor);
            Reflect.defineProperty(scope, name, {
                configurable: true,
                get() {
                    if (descriptor[7 /* tdz */]) {
                        throw new ReferenceError(`${name} is no defined`);
                    }
                    return descriptor[9 /* value */];
                },
                set(v) {
                    if (descriptor[7 /* tdz */]) {
                        throw new ReferenceError(`${name} is no defined`);
                    }
                    if (descriptor[8 /* immutable */]) {
                        throw new ReferenceError(`${name} is a constant`);
                    }
                    descriptor[9 /* value */] = v;
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
        const defineFunction = (scopes, name, type, offset) => {
            // TODO: types
            const scopeClone = [...scopes];
            const des = {
                name,
                type,
                offset,
                scopes: scopeClone
            };
            const fn = function (...args) {
                return run(program, textData, offset, scopeClone, this, args);
            };
            functionDescriptors.set(fn, des);
            return fn;
        };
        const findScope = (ctx, name) => {
            for (let i = ctx[1 /* scopes */].length - 1; i >= 0; i--) {
                if (Reflect.has(ctx[1 /* scopes */][i], name)) {
                    return ctx[1 /* scopes */][i];
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
                    throw new ReferenceError(`Non exist variable ${name}`);
                }
            }
        };
        while (ptr >= 0 && ptr < program.length) {
            const command = read();
            const currentFrame = getCurrentFrame();
            switch (command) {
                case 1 /* Literal */:
                    {
                        const value = read();
                        if (isSmallNumber(value)) {
                            currentFrame[2 /* valueStack */].push(value);
                        }
                        else {
                            currentFrame[2 /* valueStack */].push(textData[value ^ TEXT_DADA_MASK]);
                        }
                    }
                    break;
                case 11 /* Pop */:
                    currentFrame[2 /* valueStack */].pop();
                    break;
                case 12 /* GetRecord */:
                    currentFrame[2 /* valueStack */].push(currentFrame);
                    break;
                case 2 /* NullLiteral */:
                    currentFrame[2 /* valueStack */].push(null);
                    break;
                case 3 /* UndefinedLiteral */:
                    currentFrame[2 /* valueStack */].push(undefined);
                    break;
                case 13 /* Set */:
                case 14 /* SetKeepCtx */:
                    {
                        const value = currentFrame[2 /* valueStack */].pop();
                        const name = currentFrame[2 /* valueStack */].pop();
                        const ctx = currentFrame[2 /* valueStack */].pop();
                        if (!environments.has(ctx)) {
                            ctx[name] = value;
                        }
                        else {
                            const scope = findScope(ctx, name);
                            if (scope) {
                                scope[name] = value;
                            }
                            else {
                                throw new ReferenceError(`Non exist variable ${name}`);
                            }
                        }
                        if (command === 13 /* Set */) {
                            currentFrame[2 /* valueStack */].push(value);
                        }
                        else /* if (command === OpCode.SetKeepCtx) */ {
                            currentFrame[2 /* valueStack */].push(ctx);
                        }
                    }
                    break;
                case 16 /* DefineKeepCtx */:
                    {
                        const value = currentFrame[2 /* valueStack */].pop();
                        const name = currentFrame[2 /* valueStack */].pop();
                        const ctx = currentFrame[2 /* valueStack */].pop();
                        Reflect.defineProperty(ctx, name, {
                            configurable: true,
                            enumerable: true,
                            writable: true,
                            value: value
                        });
                        ctx[name] = value;
                        currentFrame[2 /* valueStack */].push(ctx);
                    }
                    break;
                case 17 /* Get */:
                    {
                        const name = currentFrame[2 /* valueStack */].pop();
                        const ctx = currentFrame[2 /* valueStack */].pop();
                        currentFrame[2 /* valueStack */].push(getValue(ctx, name));
                    }
                    break;
                case 15 /* SetMultiple */:
                    {
                        const ctx = currentFrame[2 /* valueStack */].pop();
                        const length = currentFrame[2 /* valueStack */].pop();
                        for (let i = 0; i < length; i++) {
                            const flag = currentFrame[2 /* valueStack */].pop();
                            const value = currentFrame[2 /* valueStack */].pop();
                            const name = currentFrame[2 /* valueStack */].pop();
                            let hit = false;
                            for (let i = ctx[1 /* scopes */].length - 1; i >= 0; i--) {
                                if (Reflect.has(ctx[1 /* scopes */][i], name)) {
                                    hit = true;
                                    const desc = getVariableDescriptor(ctx[1 /* scopes */][i], name);
                                    if (desc && 1 /* DeTDZ */)
                                        desc[7 /* tdz */] = false;
                                    currentFrame[1 /* scopes */][i][name] = value;
                                    if (desc && 2 /* Freeze */)
                                        desc[8 /* immutable */] = true;
                                    break;
                                }
                            }
                            if (!hit) {
                                throw new ReferenceError(`Non exist variable ${name}`);
                            }
                        }
                    }
                    break;
                case 7 /* Jump */:
                    {
                        const pos = currentFrame[2 /* valueStack */].pop();
                        ptr = pos;
                    }
                    break;
                case 6 /* JumpIfNot */:
                    {
                        const value = currentFrame[2 /* valueStack */].pop();
                        const pos = currentFrame[2 /* valueStack */].pop();
                        if (!value) {
                            ptr = pos;
                        }
                    }
                    break;
                case 8 /* EnterFunction */:
                    {
                        // TODO: arguments and this/self reference
                        const functionType = currentFrame[2 /* valueStack */].pop();
                        const variableCount = currentFrame[2 /* valueStack */].pop();
                        const variables = [];
                        for (let i = 0; i < variableCount; i++) {
                            variables.push({
                                [0 /* type */]: currentFrame[2 /* valueStack */].pop(),
                                [6 /* name */]: currentFrame[2 /* valueStack */].pop()
                            });
                        }
                        const argumentNameCount = currentFrame[2 /* valueStack */].pop();
                        const argumentNames = [];
                        for (let i = 0; i < argumentNameCount; i++) {
                            argumentNames.push(currentFrame[2 /* valueStack */].pop());
                        }
                        const parameterCount = currentFrame[2 /* valueStack */].pop();
                        const parameters = [];
                        for (let i = 0; i < parameterCount; i++) {
                            parameters.unshift(currentFrame[2 /* valueStack */].pop());
                        }
                        // TODO: arguments and this/self reference
                        const self = currentFrame[2 /* valueStack */].pop();
                        const scope = {};
                        currentFrame[1 /* scopes */].push(scope);
                        for (let v of variables) {
                            defineVariable(scope, v[6 /* name */], v[0 /* type */]);
                        }
                        for (let [index, name] of argumentNames.entries()) {
                            scope[name] = parameters[index];
                        }
                    }
                    break;
                case 9 /* EnterScope */:
                    {
                        const variableCount = currentFrame[2 /* valueStack */].pop();
                        const variables = [];
                        for (let i = 0; i < variableCount; i++) {
                            variables.push({
                                [0 /* type */]: currentFrame[2 /* valueStack */].pop(),
                                [6 /* name */]: currentFrame[2 /* valueStack */].pop()
                            });
                        }
                        const scope = {};
                        currentFrame[1 /* scopes */].push(scope);
                        for (let v of variables) {
                            defineVariable(scope, v[6 /* name */], v[0 /* type */]);
                        }
                    }
                    break;
                case 10 /* LeaveScope */:
                    {
                        currentFrame[1 /* scopes */].pop();
                    }
                    break;
                case 18 /* DeTDZ */:
                    {
                        const env = peak(currentFrame[2 /* valueStack */], 2);
                        const name = peak(currentFrame[2 /* valueStack */]);
                        getVariableDescriptor(peak(env[1 /* scopes */]), name)[7 /* tdz */] = false;
                    }
                    break;
                case 19 /* FreezeVariable */:
                    {
                        const env = peak(currentFrame[2 /* valueStack */], 2);
                        const name = peak(currentFrame[2 /* valueStack */]);
                        getVariableDescriptor(peak(env[1 /* scopes */]), name)[8 /* immutable */] = true;
                    }
                    break;
                case 20 /* DefineFunction */:
                    {
                        const type = currentFrame[2 /* valueStack */].pop();
                        const offset = currentFrame[2 /* valueStack */].pop();
                        const name = currentFrame[2 /* valueStack */].pop();
                        currentFrame[2 /* valueStack */].push(defineFunction(currentFrame[1 /* scopes */], name, type, offset));
                    }
                    break;
                case 23 /* Call */:
                    {
                        const parameterCount = currentFrame[2 /* valueStack */].pop();
                        const parameters = [];
                        for (let i = 0; i < parameterCount; i++) {
                            parameters.unshift(currentFrame[2 /* valueStack */].pop());
                        }
                        const name = currentFrame[2 /* valueStack */].pop();
                        const envOrRecord = currentFrame[2 /* valueStack */].pop();
                        let fn = getValue(envOrRecord, name);
                        let self = undefined;
                        if (!environments.has(envOrRecord)) {
                            self = envOrRecord;
                        }
                        if (!functionDescriptors.has(fn)) {
                            // extern
                            currentFrame[2 /* valueStack */].push(Reflect.apply(fn, self, parameters));
                        }
                        else {
                            const des = functionDescriptors.get(fn);
                            const newFrame = {
                                [0 /* type */]: 0 /* Function */,
                                [1 /* scopes */]: [...des.scopes],
                                [3 /* return */]: ptr,
                                [2 /* valueStack */]: [
                                    self,
                                    ...parameters,
                                    parameters.length
                                ]
                            };
                            environments.add(newFrame);
                            stack.push(newFrame);
                            ptr = des.offset;
                        }
                    }
                    break;
                case 21 /* Return */:
                    {
                        const result = currentFrame[2 /* valueStack */].pop();
                        if (currentFrame[2 /* valueStack */].length > 0) {
                            throw new Error('bad return');
                        }
                        // remove all try frames
                        while (peak(stack)[0 /* type */] !== 0 /* Function */) {
                            stack.pop();
                        }
                        const returnAddr = peak(stack)[3 /* return */];
                        if (returnAddr < 0) {
                            // leave the whole function
                            return result;
                        }
                        stack.pop();
                        peak(stack)[2 /* valueStack */].push(result);
                        ptr = returnAddr;
                    }
                    break;
                case 22 /* ReturnBare */:
                    {
                        if (currentFrame[2 /* valueStack */].length > 0) {
                            throw new Error('bad return');
                        }
                        // remove all try frames
                        while (peak(stack)[0 /* type */] !== 0 /* Function */) {
                            stack.pop();
                        }
                        const returnAddr = peak(stack)[3 /* return */];
                        if (returnAddr < 0) {
                            // leave the whole function
                            return undefined;
                        }
                        stack.pop();
                        peak(stack)[2 /* valueStack */].push(undefined);
                        ptr = returnAddr;
                    }
                    break;
                case 24 /* ArrayLiteral */:
                    currentFrame[2 /* valueStack */].push([]);
                    break;
                case 25 /* ObjectLiteral */:
                    currentFrame[2 /* valueStack */].push({});
                    break;
                case 29 /* BAmpersand */:
                case 31 /* BAmpersandAmpersand */:
                case 30 /* BBar */:
                case 32 /* BBarBar */:
                case 28 /* BCaret */:
                case 40 /* BEqualsEquals */:
                case 41 /* BEqualsEqualsEquals */:
                case 33 /* BGreaterThan */:
                case 34 /* BGreaterThanGreaterThan */:
                case 35 /* BGreaterThanGreaterThanGreaterThan */:
                case 36 /* BGreaterThanEquals */:
                case 37 /* BLessThan */:
                case 38 /* BLessThanLessThan */:
                case 39 /* BLessThanEquals */:
                case 40 /* BEqualsEquals */:
                case 41 /* BEqualsEqualsEquals */:
                case 27 /* BMinus */:
                case 26 /* BPlus */:
                    {
                        const right = currentFrame[2 /* valueStack */].pop();
                        const left = currentFrame[2 /* valueStack */].pop();
                        const ops = {
                            [29 /* BAmpersand */]: (left, right) => left & right,
                            [31 /* BAmpersandAmpersand */]: (left, right) => left && right,
                            [30 /* BBar */]: (left, right) => left | right,
                            [32 /* BBarBar */]: (left, right) => left || right,
                            [28 /* BCaret */]: (left, right) => left ^ right,
                            [40 /* BEqualsEquals */]: (left, right) => left == right,
                            [41 /* BEqualsEqualsEquals */]: (left, right) => left === right,
                            [33 /* BGreaterThan */]: (left, right) => left > right,
                            [34 /* BGreaterThanGreaterThan */]: (left, right) => left >> right,
                            [35 /* BGreaterThanGreaterThanGreaterThan */]: (left, right) => left >>> right,
                            [36 /* BGreaterThanEquals */]: (left, right) => left >= right,
                            [37 /* BLessThan */]: (left, right) => left < right,
                            [38 /* BLessThanLessThan */]: (left, right) => left << right,
                            [39 /* BLessThanEquals */]: (left, right) => left <= right,
                            [26 /* BPlus */]: (left, right) => left + right,
                            [27 /* BMinus */]: (left, right) => left - right,
                        };
                        const result = ops[command](left, right);
                        currentFrame[2 /* valueStack */].push(result);
                    }
                    break;
                case 43 /* PostFixPlusPLus */:
                case 42 /* PostFixMinusMinus */:
                    {
                        const name = currentFrame[2 /* valueStack */].pop();
                        const ctx = currentFrame[2 /* valueStack */].pop();
                        if (environments.has(ctx)) {
                            const env = ctx;
                            const scope = findScope(env, name);
                            if (scope) {
                                const old = scope[name];
                                const newVal = command === 43 /* PostFixPlusPLus */ ? old + 1 : old - 1;
                                scope[name] = newVal;
                                currentFrame[2 /* valueStack */].push(old);
                            }
                            else {
                                throw new ReferenceError(`${name} is not defined`);
                            }
                        }
                        else {
                            const self = ctx;
                            const old = self[name];
                            const newVal = command === 43 /* PostFixPlusPLus */ ? old + 1 : old - 1;
                            self[name] = newVal;
                            currentFrame[2 /* valueStack */].push(old);
                        }
                    }
                    break;
                case 44 /* Debugger */:
                    debugger;
                    break;
                case 5 /* NodeFunctionType */:
                case 4 /* NodeOffset */:
                case 0 /* Nop */:
                    throw new Error('Why are you here?');
                default:
                    const nothing = command;
                    throw new Error('Unknown Op');
            }
        }
    }
    
    const t = ["t","a","b","","console","log","location","href","c","crcTable","n","k",3988292384,"str","crc","i",-1,"length","charCodeAt"]
    const p = new Int32Array(Uint8Array.from(atob('AQAAAAAAAAABAAAAAAAAgAEAAAACAAAAAQAAAAEAAIABAAAAAQAAAAEAAAACAACAAQAAAAEAAAABAAAAAwAAAAEAAAApAQAACAAAAAwAAAABAAAAAAAAgBIAAAALAAAACwAAAAwAAAABAAAAAQAAgAEAAAADAACAAQAAAEkAAAABAAAA0AAAABQAAAANAAAACwAAAAwAAAABAAAAAgAAgAEAAAADAACAAQAAAAwBAAABAAAA0AAAABQAAAANAAAACwAAAAwAAAABAAAABAAAgBEAAAABAAAABQAAgAwAAAABAAAAAgAAgAwAAAABAAAABgAAgBEAAAABAAAABwAAgBEAAAABAAAAAQAAABcAAAABAAAAAQAAABcAAAALAAAAFgAAAAEAAAAAAAAAAQAAAAgAAIABAAAAAQAAAAEAAAAJAACAAQAAAAEAAAABAAAACgAAgAEAAAABAAAAAQAAAAsAAIABAAAAAQAAAAEAAAAEAAAAAQAAANAAAAAIAAAADAAAAAEAAAAJAACAGAAAAA0AAAALAAAAAQAAAAAAAAAJAAAACQAAAAwAAAABAAAACgAAgAEAAAAAAAAADQAAAAsAAAABAAAABQEAAAwAAAABAAAACgAAgBEAAAABAAAAAAEAACUAAAAGAAAAAQAAAAAAAAAJAAAADAAAAAEAAAAIAACADAAAAAEAAAAKAACAEQAAAA0AAAALAAAAAQAAAAAAAAAJAAAACQAAAAwAAAABAAAACwAAgAEAAAAAAAAADQAAAAsAAAABAAAA3AAAAAwAAAABAAAACwAAgBEAAAABAAAACAAAACUAAAAGAAAAAQAAAAAAAAAJAAAADAAAAAEAAAAIAACAAQAAALkAAAAMAAAAAQAAAAgAAIARAAAAAQAAAAEAAAAdAAAABgAAAAEAAAAMAACADAAAAAEAAAAIAACAEQAAAAEAAAABAAAAIwAAABwAAAABAAAAwAAAAAcAAAAMAAAAAQAAAAgAAIARAAAAAQAAAAEAAAAjAAAADQAAAAsAAAAKAAAAAQAAAAsAAIAMAAAAAQAAAAsAAIARAAAAAQAAAAAAAAABAAAAAQAAAAoAAAABAAAAAAAAAAkAAAAJAAAADAAAAA8AAAAMAAAAAQAAAAsAAIArAAAACwAAAAEAAACSAAAABwAAAAoAAAAMAAAAAQAAAAkAAIARAAAADAAAAAEAAAAKAACAEQAAAAwAAAABAAAACAAAgBEAAAANAAAACwAAAAoAAAABAAAACgAAgAwAAAABAAAACgAAgBEAAAABAAAAAAAAAAEAAAABAAAACgAAAAEAAAAAAAAACQAAAAkAAAAMAAAADwAAAAwAAAABAAAACgAAgCsAAAALAAAAAQAAAHEAAAAHAAAACgAAAAwAAAABAAAACQAAgBEAAAAVAAAAFgAAAAEAAAANAACAAQAAAAEAAAABAAAADQAAgAEAAAAEAAAAAQAAAAkAAIABAAAAAQAAAAEAAAAOAACAAQAAAAEAAAABAAAADwAAgAEAAAABAAAAAQAAAAQAAAABAAAA0AAAAAgAAAAMAAAAAQAAAAkAAIAMAAAAAQAAAAAAAIARAAAADAAAAAEAAAAAAACADAAAAAEAAAABAACAAQAAAAAAAAAXAAAADQAAACAAAAANAAAACwAAAAwAAAABAAAADgAAgAEAAAAAAAAAAQAAABAAAIAcAAAADQAAAAsAAAABAAAAAAAAAAkAAAAJAAAADAAAAAEAAAAPAACAAQAAAAAAAAANAAAACwAAAAEAAAChAQAADAAAAAEAAAAPAACAEQAAAAwAAAABAAAADQAAgBEAAAABAAAAEQAAgBEAAAAlAAAABgAAAAEAAAAAAAAACQAAAAwAAAABAAAADgAAgAwAAAABAAAADgAAgBEAAAABAAAACAAAACMAAAAMAAAAAQAAAAkAAIARAAAADAAAAAEAAAAOAACAEQAAAAwAAAABAAAADQAAgBEAAAABAAAAEgAAgAwAAAABAAAADwAAgBEAAAABAAAAAQAAABcAAAAcAAAAAQAAAP8AAAAdAAAAEQAAABwAAAANAAAACwAAAAoAAAABAAAADwAAgAwAAAABAAAADwAAgBEAAAABAAAAAAAAAAEAAAABAAAACgAAAAEAAAAAAAAACQAAAAkAAAAMAAAADwAAAAwAAAABAAAADwAAgCsAAAALAAAAAQAAAE4BAAAHAAAACgAAAAwAAAABAAAADgAAgBEAAAABAAAAEAAAgBwAAAABAAAAAAAAACMAAAAVAAAAFgAAAA=='), c => c.charCodeAt(0)).buffer)
    run(p, t, 0, [globalThis])
    }