/**
 * Debug tests: run failing cases through debugRun to observe instruction traces.
 * These are not permanent tests — they exist to diagnose obfuscation bugs.
 */
import { debugRun } from './debug-run'

test('debug: class ES6 Semantic', () => {
    // This reproduces the class.test.ts failure with a fixed seed.
    const result = debugRun(`
        let constructCheck = false;
        let newTargetCheck = false;

        class Base {
            constructor() {
                constructCheck = true;
                if (new.target === Derived) {
                    newTargetCheck = true;
                }
            }
        }

        class Derived extends Base {
            constructor() {
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
        const result = { obj, constructCheck, newTargetCheck };
        result;
    `, { shuffleSeed: 42, trace: true }) as any

    expect(result.constructCheck).toBe(true)
    expect(result.newTargetCheck).toBe(true)
    expect(result.obj.tdzFail).toBe(true)
    expect(result.obj.isDerived).toBe(true)
})

test('debug: finally does not affect result', () => {
    const result = debugRun('try { 42 } catch (err) {} finally { 43 }', {
        shuffleSeed: 42, trace: true
    })
    expect(result).toBe(42)
})
