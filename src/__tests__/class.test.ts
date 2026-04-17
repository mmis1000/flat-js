import * as compiler from '../compiler'
import * as runtime from '../runtime'

test('ES6 Classes Semantic', () => {
    const code = `
        let constructCheck = false;
        let newTargetCheck = false;
        
        class Base {
            constructor() { console.log('Derived ctor'); 
                constructCheck = true;
                if (new.target === Derived) {
                    newTargetCheck = true;
                }
            }
        }
        
        class Derived extends Base {
            constructor() {
                // accessing this before super should fail
                let tdzFail = false;
                try {
                    this.a = 1;
                } catch (e) {
                    tdzFail = true;
                }
                
                super();
                this.tdzFail = tdzFail;
                this.isDerived = true;
            }
        }

        const obj = new Derived();
        
        const result = {
            obj,
            constructCheck,
            newTargetCheck,
        };
        result;
    `;

    const [program] = compiler.compile(code, { evalMode: true })
    const result = runtime.run(program, 0, globalThis, [{}]) as any;

    expect(result.constructCheck).toBe(true);
    expect(result.newTargetCheck).toBe(true);
    expect(result.obj.tdzFail).toBe(true);
    expect(result.obj.isDerived).toBe(true);
    expect(result.obj.constructor.name).toBe('Derived');
});

test('Extending Built-in Array', () => {
    const code = `
        class MyArray extends Array {
            constructor(a, b) {
                super(a, b);
                this.isCustom = true;
            }
        }
        
        const arr = new MyArray(10, 20);
        const result = {
            isArray: Array.isArray(arr),
            length: arr.length,
            val0: arr[0],
            isInstance: arr instanceof MyArray,
            isCustom: arr.isCustom,
            constructorName: arr.constructor.name
        };
        result;
    `;

    const [program] = compiler.compile(code, { evalMode: true })
    const result = runtime.run(program, 0, globalThis, [{}]) as any;

    expect(result.isArray).toBe(true);
    expect(result.length).toBe(2);
    expect(result.val0).toBe(10);
    expect(result.isInstance).toBe(true);
    expect(result.isCustom).toBe(true);
    expect(result.constructorName).toBe('MyArray');
});

test('Extending Built-in Array with Default Constructor', () => {
    const code = `
        class C extends Array {}
        const inst = new C();
        const result = {
            isArray: Array.isArray(inst),
            isInstance: inst instanceof C,
            constructorName: inst.constructor.name
        };
        result;
    `;

    const [program] = compiler.compile(code, { evalMode: true })
    const result = runtime.run(program, 0, globalThis, [{}]) as any;

    expect(result.isArray).toBe(true);
    expect(result.isInstance).toBe(true);
    expect(result.constructorName).toBe('C');
});

test('Constructor Return Override', () => {
    const code = `
        class C {
            constructor() {
                return { override: true };
            }
        }
        class D {
            constructor() {
                return null;
            }
        }
        
        const instC = new C();
        const instD = new D();
        
        const result = {
            cOverride: instC.override === true,
            cInstanceOf: instC instanceof C,
            dInstanceOf: instD instanceof D
        };
        result;
    `;

    const [program] = compiler.compile(code, { evalMode: true })
    const result = runtime.run(program, 0, globalThis, [{}]) as any;

    expect(result.cOverride).toBe(true);
    expect(result.cInstanceOf).toBe(false); // Should be the plain object, not instance of C
    expect(result.dInstanceOf).toBe(true);  // null should return the instance
});
