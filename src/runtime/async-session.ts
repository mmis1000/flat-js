import { InvokeType } from "../compiler"
import { getExecution } from "./execution"
import type { DebugCallback } from "./opcodes/types"
import {
    Fields,
    functionDescriptors,
    isAsyncType,
    markVmOwned,
    type Execution,
    type FunctionDescriptor,
    type Result,
    type ResultAwait,
    type RuntimeAdmitValue,
    type RuntimeAsyncExecutionRequest,
    type RuntimeAsyncHost,
    type Scope,
} from "./shared"

export type VmPromiseState = 'pending' | 'fulfilled' | 'rejected'

export type VmPromiseRecord = {
    id: number
    promise: object
    state: VmPromiseState
    value: unknown
    fulfillReactions: VmPromiseReaction[]
    rejectReactions: VmPromiseReaction[]
}

export type VmPromiseReactionKind = 'fulfilled' | 'rejected'

export type VmPromiseThenReaction = {
    type: 'then'
    kind: VmPromiseReactionKind
    handler: unknown
    result: VmPromiseRecord
}

export type VmPromiseAwaitReaction = {
    type: 'await'
    kind: VmPromiseReactionKind
    task: VmAsyncTask
}

export type VmPromiseReaction = VmPromiseThenReaction | VmPromiseAwaitReaction

export type VmThenJob = {
    id: number
    type: 'then'
    reaction: VmPromiseThenReaction
    argument: unknown
    execution?: Execution
}

export type VmAsyncContinuationJob = {
    id: number
    type: 'asyncContinuation'
    task: VmAsyncTask
    kind: VmPromiseReactionKind
    argument: unknown
}

export type VmAsyncStartJob = {
    id: number
    type: 'asyncStart'
    task: VmAsyncTask
}

export type VmJob = VmThenJob | VmAsyncContinuationJob | VmAsyncStartJob

export type VmAsyncTask = {
    id: number
    execution: Execution
    promise: VmPromiseRecord
}

export type VmTimerRecord = {
    id: number
    dueTick: number
    promise: VmPromiseRecord
    value: unknown
}

export type VmAsyncSessionBuiltinId =
    | 'Promise'
    | 'Promise.prototype'
    | 'Promise.prototype.then'
    | 'Promise.prototype.catch'
    | 'Promise.resolve'
    | 'Promise.reject'
    | 'vmSleep'

export type VmAsyncSessionSerializableState = {
    program: number[]
    globalThis: object
    mainExecution: Execution
    promises: VmPromiseRecord[]
    asyncTasks: VmAsyncTask[]
    jobs: VmJob[]
    timers: VmTimerRecord[]
    activeJob: VmJob | null
    currentTick: number
    nextPromiseId: number
    nextJobId: number
    nextTimerId: number
    nextAsyncTaskId: number
    mainDone: boolean
    paused: boolean
    pausedPtr: number | undefined
    pausedExecution: Execution | null
}

export type VmAsyncSessionRestoreShellOptions = {
    globalThis?: object
    compileFunction?: typeof import('../compiler').compile
    functionRedirects?: WeakMap<Function, Function>
    admitValue?: RuntimeAdmitValue
    hostPromisePolicy?: VmAsyncSessionHostPromisePolicy
    onPause?: (info: VmAsyncSessionPauseInfo) => void
}

export type VmAsyncSessionHostPromisePolicy = {
    createHostThenableRejection(value: unknown, cause?: unknown): unknown
}

type VmAsyncSessionInternalOptions = {
    skipMainExecution?: boolean
}

type VmAsyncSessionBuiltinBaseline = {
    prototype: object | null
    extensible: boolean
    descriptors: Record<PropertyKey, PropertyDescriptor>
}

const isObjectLike = (value: unknown): value is object =>
    (typeof value === 'object' && value !== null) || typeof value === 'function'

const captureBuiltinBaseline = (value: object): VmAsyncSessionBuiltinBaseline => ({
    prototype: Object.getPrototypeOf(value),
    extensible: Object.isExtensible(value),
    descriptors: Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>,
})

const haveSameDescriptor = (left: PropertyDescriptor, right: PropertyDescriptor) => {
    if (left.configurable !== right.configurable || left.enumerable !== right.enumerable) {
        return false
    }
    const leftIsData = 'value' in left || 'writable' in left
    const rightIsData = 'value' in right || 'writable' in right
    if (leftIsData !== rightIsData) {
        return false
    }
    if (leftIsData) {
        return left.writable === right.writable && Object.is(left.value, right.value)
    }
    return left.get === right.get && left.set === right.set
}

const strictHostPromisePolicy: VmAsyncSessionHostPromisePolicy = {
    createHostThenableRejection(_value, cause) {
        return cause ?? new TypeError('Host thenables are unsupported in VM async sessions')
    },
}

export type VmAsyncSessionRunResult = {
    paused: boolean
    mainDone: boolean
    queuedJobs: number
    pendingTimers: number
}

export type VmAsyncSessionAdvanceResult = {
    currentTick: number
    settledTimers: number
}

export type VmAsyncSessionPauseInfo = {
    ptr: number | undefined
    execution: Execution | null
}

export type VmAsyncSessionOptions = {
    entryPoint?: number
    globalThis: object
    scopes?: Scope[]
    args?: unknown[]
    compileFunction?: typeof import('../compiler').compile
    functionRedirects?: WeakMap<Function, Function>
    admitValue?: RuntimeAdmitValue
    hostPromisePolicy?: VmAsyncSessionHostPromisePolicy
    onPause?: (info: VmAsyncSessionPauseInfo) => void
}

export class VmAsyncSession implements RuntimeAsyncHost {
    readonly Promise: Function
    readonly vmSleep: (ticks?: unknown, value?: unknown) => object
    mainExecution: Execution

    private programValue: number[]
    private globalThisValue: object
    private readonly compileFunction: typeof import('../compiler').compile
    private readonly functionRedirects: WeakMap<Function, Function>
    private readonly admitValue: RuntimeAdmitValue
    private readonly hostPromisePolicy: VmAsyncSessionHostPromisePolicy
    private readonly onPause?: (info: VmAsyncSessionPauseInfo) => void
    private readonly promisePrototype: object
    private readonly promiseRecords = new WeakMap<object, VmPromiseRecord>()
    private readonly promises: VmPromiseRecord[] = []
    private readonly asyncTasks: VmAsyncTask[] = []
    private readonly jobs: VmJob[] = []
    private readonly timers: VmTimerRecord[] = []
    private readonly serializationBuiltinIds = new WeakMap<object, VmAsyncSessionBuiltinId>()
    private readonly serializationBuiltinValues = new Map<VmAsyncSessionBuiltinId, unknown>()
    private readonly serializationBuiltinBaselines = new WeakMap<object, VmAsyncSessionBuiltinBaseline>()

    private currentTickValue = 0
    private nextPromiseId = 1
    private nextJobId = 1
    private nextTimerId = 1
    private nextAsyncTaskId = 1
    private mainDoneValue = false
    private pausedValue = false
    private pausedPtrValue: number | undefined
    private pausedExecutionValue: Execution | null = null
    private activeJob: VmJob | null = null

    constructor(
        program: number[],
        options: VmAsyncSessionOptions,
        internalOptions: VmAsyncSessionInternalOptions = {}
    ) {
        this.programValue = program
        this.globalThisValue = options.globalThis
        markVmOwned(this.globalThisValue)
        this.compileFunction = options.compileFunction ?? ((..._args: any[]) => { throw new Error('not supported') })
        this.functionRedirects = options.functionRedirects ?? new WeakMap()
        this.admitValue = options.admitValue ?? (() => {})
        this.hostPromisePolicy = options.hostPromisePolicy ?? strictHostPromisePolicy
        this.onPause = options.onPause
        this.promisePrototype = markVmOwned(Object.create((this.globalThisValue as any).Object?.prototype ?? Object.prototype))
        this.Promise = this.createPromiseConstructor()
        this.vmSleep = markVmOwned((ticks?: unknown, value?: unknown) => this.sleep(ticks, value))
        this.registerSerializationBuiltin('vmSleep', this.vmSleep)
        this.installGlobals()
        this.captureSerializationBuiltinBaselines()
        if (internalOptions.skipMainExecution) {
            this.mainExecution = undefined as unknown as Execution
        } else {
            this.mainExecution = getExecution(
                program,
                options.entryPoint ?? 0,
                this.globalThisValue,
                options.scopes ?? [],
                undefined,
                options.args ?? [],
                this.getDebugFunction,
                this.compileFunction,
                this.functionRedirects,
                null,
                this.admitValue,
                this
            )
        }
    }

    get paused() {
        return this.pausedValue
    }

    get pausedPtr() {
        return this.pausedPtrValue
    }

    get pausedExecution() {
        return this.pausedExecutionValue
    }

    get activeExecution(): Execution {
        if (!this.activeJob) {
            return this.mainExecution
        }
        if (this.activeJob.type === 'then') {
            return this.activeJob.execution ?? this.mainExecution
        }
        return this.activeJob.task.execution
    }

    get debugExecution(): Execution {
        return this.pausedExecutionValue ?? this.activeExecution
    }

    get currentTick() {
        return this.currentTickValue
    }

    getSerializableState(): VmAsyncSessionSerializableState {
        return {
            program: this.programValue,
            globalThis: this.globalThisValue,
            mainExecution: this.mainExecution,
            promises: [...this.promises],
            asyncTasks: [...this.asyncTasks],
            jobs: [...this.jobs],
            timers: [...this.timers],
            activeJob: this.activeJob,
            currentTick: this.currentTickValue,
            nextPromiseId: this.nextPromiseId,
            nextJobId: this.nextJobId,
            nextTimerId: this.nextTimerId,
            nextAsyncTaskId: this.nextAsyncTaskId,
            mainDone: this.mainDoneValue,
            paused: this.pausedValue,
            pausedPtr: this.pausedPtrValue,
            pausedExecution: this.pausedExecutionValue,
        }
    }

    restoreSerializableState(state: VmAsyncSessionSerializableState) {
        this.programValue = state.program
        this.globalThisValue = state.globalThis
        this.mainExecution = state.mainExecution

        this.promises.length = 0
        for (const promise of state.promises) {
            this.promises.push(promise)
            this.promiseRecords.set(promise.promise, promise)
        }

        this.asyncTasks.length = 0
        this.asyncTasks.push(...state.asyncTasks)
        this.jobs.length = 0
        this.jobs.push(...state.jobs)
        this.timers.length = 0
        this.timers.push(...state.timers)

        this.activeJob = state.activeJob
        this.currentTickValue = state.currentTick
        this.nextPromiseId = state.nextPromiseId
        this.nextJobId = state.nextJobId
        this.nextTimerId = state.nextTimerId
        this.nextAsyncTaskId = state.nextAsyncTaskId
        this.mainDoneValue = state.mainDone
        this.pausedValue = state.paused
        this.pausedPtrValue = state.pausedPtr
        this.pausedExecutionValue = state.pausedExecution
    }

    getDebugFunctionForSerialization(): () => null | DebugCallback {
        return this.getDebugFunction
    }

    getSerializationBuiltinId(value: unknown): VmAsyncSessionBuiltinId | undefined {
        if (!isObjectLike(value)) {
            return undefined
        }
        return this.serializationBuiltinIds.get(value)
    }

    getSerializationBuiltinValue(id: VmAsyncSessionBuiltinId): unknown {
        if (!this.serializationBuiltinValues.has(id)) {
            throw new Error(`Missing VM async session builtin '${id}'`)
        }
        return this.serializationBuiltinValues.get(id)
    }

    getSerializationBuiltinMutationReason(value: unknown): string | undefined {
        if (!isObjectLike(value)) {
            return undefined
        }
        const id = this.serializationBuiltinIds.get(value)
        if (id === undefined) {
            return undefined
        }
        const baseline = this.serializationBuiltinBaselines.get(value)
        if (baseline === undefined) {
            return `VM async session builtin '${id}' baseline is missing`
        }
        if (Object.getPrototypeOf(value) !== baseline.prototype) {
            return `VM async session builtin '${id}' prototype changes are unsupported`
        }
        if (Object.isExtensible(value) !== baseline.extensible) {
            return `VM async session builtin '${id}' extensibility changes are unsupported`
        }
        const descriptors = Object.getOwnPropertyDescriptors(value) as Record<PropertyKey, PropertyDescriptor>
        const keys = new Set([...Reflect.ownKeys(baseline.descriptors), ...Reflect.ownKeys(descriptors)])
        for (const key of keys) {
            const baselineDescriptor = baseline.descriptors[key]
            const descriptor = descriptors[key]
            if (baselineDescriptor === undefined || descriptor === undefined || !haveSameDescriptor(descriptor, baselineDescriptor)) {
                return `VM async session builtin '${id}' property changes are unsupported`
            }
        }
        return undefined
    }

    getPromiseRecordForSerialization(value: unknown): VmPromiseRecord | undefined {
        return this.promiseRecordFor(value)
    }

    runUntilIdleOrPause(): VmAsyncSessionRunResult {
        if (this.pausedValue) {
            return this.result()
        }

        if (this.activeJob) {
            this.runActiveJob()
            if (this.pausedValue) {
                return this.result()
            }
        }

        if (!this.mainDoneValue) {
            this.runMain()
            if (this.pausedValue) {
                return this.result()
            }
        }

        while (!this.pausedValue && this.jobs.length > 0) {
            this.activeJob = this.jobs.shift()!
            this.runActiveJob()
        }

        return this.result()
    }

    resume(): VmAsyncSessionRunResult {
        this.pausedValue = false
        this.pausedPtrValue = undefined
        this.pausedExecutionValue = null
        return this.runUntilIdleOrPause()
    }

    advanceTime(ticks: number): VmAsyncSessionAdvanceResult {
        if (this.pausedValue) {
            return { currentTick: this.currentTickValue, settledTimers: 0 }
        }
        if (!Number.isFinite(ticks) || ticks < 0) {
            throw new RangeError('ticks must be a non-negative finite number')
        }
        this.currentTickValue += ticks
        let settledTimers = 0
        let changed = true
        while (changed) {
            changed = false
            for (let index = 0; index < this.timers.length; index++) {
                const timer = this.timers[index]
                if (timer.dueTick > this.currentTickValue) {
                    continue
                }
                this.timers.splice(index, 1)
                settledTimers++
                changed = true
                this.resolveRecord(timer.promise, timer.value)
                break
            }
        }
        return { currentTick: this.currentTickValue, settledTimers }
    }

    sleep(ticks?: unknown, value: unknown = undefined): object {
        const promise = this.createPromiseRecord()
        const delay = Math.max(0, Math.ceil(Number(ticks) || 0))
        if (delay === 0) {
            this.resolveRecord(promise, value)
        } else {
            this.timers.push({
                id: this.nextTimerId++,
                dueTick: this.currentTickValue + delay,
                promise,
                value,
            })
            this.timers.sort((left, right) => left.dueTick - right.dueTick || left.id - right.id)
        }
        return promise.promise
    }

    createAsyncFromExecution(request: RuntimeAsyncExecutionRequest): unknown {
        const promise = this.createPromiseRecord()
        const execution = getExecution(
            request.program,
            request.offset,
            request.globalThis,
            [...request.scopes],
            request.invokeData,
            request.args,
            this.getDebugFunction,
            this.compileFunction,
            this.functionRedirects,
            null,
            this.admitValue,
            this
        )
        const task: VmAsyncTask = {
            id: this.nextAsyncTaskId++,
            execution,
            promise,
        }
        this.asyncTasks.push(task)
        const previousActiveJob = this.activeJob
        const startJob: VmAsyncStartJob = {
            id: this.nextJobId++,
            type: 'asyncStart',
            task,
        }
        this.activeJob = startJob
        this.runActiveJob()
        if (!this.pausedValue) {
            this.activeJob = previousActiveJob
        }
        return promise.promise
    }

    private readonly getDebugFunction = (): DebugCallback => (ptr?: number) => {
        const execution = this.activeJob
            ? this.activeJob.type === 'then'
                ? this.activeJob.execution ?? null
                : this.activeJob.task.execution
            : this.mainExecution ?? null
        this.pausedValue = true
        this.pausedPtrValue = ptr
        this.pausedExecutionValue = execution
        this.onPause?.({ ptr, execution })
    }

    private registerSerializationBuiltin(id: VmAsyncSessionBuiltinId, value: unknown) {
        this.serializationBuiltinValues.set(id, value)
        if (isObjectLike(value)) {
            this.serializationBuiltinIds.set(value, id)
        }
    }

    private captureSerializationBuiltinBaselines() {
        for (const value of this.serializationBuiltinValues.values()) {
            if (isObjectLike(value)) {
                this.serializationBuiltinBaselines.set(value, captureBuiltinBaseline(value))
            }
        }
    }

    private createPromiseConstructor(): Function {
        const session = this
        const then = markVmOwned(function then(this: object, onFulfilled?: unknown, onRejected?: unknown) {
            return session.then(this, onFulfilled, onRejected)
        })
        const catchMethod = markVmOwned(function catchMethod(this: object, onRejected?: unknown) {
            return session.then(this, undefined, onRejected)
        })

        let PromiseCtor: any
        PromiseCtor = markVmOwned(function VmPromise(this: object, executor: unknown) {
            if (!(this instanceof PromiseCtor)) {
                throw new TypeError('Promise constructor requires new')
            }
            if (typeof executor !== 'function') {
                throw new TypeError('Promise resolver is not a function')
            }
            const record = session.initializePromiseObject(this)
            let settled = false
            const resolve = markVmOwned(function resolve(value: unknown) {
                if (settled) return
                settled = true
                session.resolveRecord(record, value)
            })
            const reject = markVmOwned(function reject(reason: unknown) {
                if (settled) return
                settled = true
                session.rejectRecord(record, reason)
            })
            try {
                Reflect.apply(executor, undefined, [resolve, reject])
            } catch (error) {
                reject(error)
            }
        })
        const resolveMethod = markVmOwned(function resolve(value: unknown) {
            return session.resolve(value)
        })
        const rejectMethod = markVmOwned(function reject(reason: unknown) {
            return session.reject(reason)
        })

        Object.defineProperties(this.promisePrototype, {
            constructor: {
                configurable: true,
                writable: true,
                value: PromiseCtor,
            },
            then: {
                configurable: true,
                writable: true,
                value: then,
            },
            catch: {
                configurable: true,
                writable: true,
                value: catchMethod,
            },
        })
        Object.defineProperties(PromiseCtor, {
            prototype: {
                configurable: false,
                writable: false,
                value: this.promisePrototype,
            },
            resolve: {
                configurable: true,
                writable: true,
                value: resolveMethod,
            },
            reject: {
                configurable: true,
                writable: true,
                value: rejectMethod,
            },
        })
        Object.setPrototypeOf(PromiseCtor, (this.globalThisValue as any).Function?.prototype ?? Function.prototype)
        this.registerSerializationBuiltin('Promise', PromiseCtor)
        this.registerSerializationBuiltin('Promise.prototype', this.promisePrototype)
        this.registerSerializationBuiltin('Promise.prototype.then', then)
        this.registerSerializationBuiltin('Promise.prototype.catch', catchMethod)
        this.registerSerializationBuiltin('Promise.resolve', resolveMethod)
        this.registerSerializationBuiltin('Promise.reject', rejectMethod)
        return PromiseCtor
    }

    private installGlobals() {
        for (const [name, value] of [
            ['Promise', this.Promise],
            ['vmSleep', this.vmSleep],
        ] as const) {
            if (!Reflect.defineProperty(this.globalThisValue, name, {
                configurable: true,
                enumerable: false,
                writable: true,
                value,
            })) {
                throw new TypeError(`Cannot install ${name} on VM global`)
            }
        }
    }

    private resolve(value: unknown): object {
        const record = this.createPromiseRecord()
        this.resolveRecord(record, value)
        return record.promise
    }

    private reject(reason: unknown): object {
        const record = this.createPromiseRecord()
        this.rejectRecord(record, reason)
        return record.promise
    }

    private then(promise: object, onFulfilled: unknown, onRejected: unknown): object {
        const record = this.promiseRecords.get(promise)
        if (!record) {
            throw new TypeError('Promise.prototype.then called on incompatible receiver')
        }
        const result = this.createPromiseRecord()
        this.addReaction(record, {
            type: 'then',
            kind: 'fulfilled',
            handler: typeof onFulfilled === 'function' ? onFulfilled : undefined,
            result,
        })
        this.addReaction(record, {
            type: 'then',
            kind: 'rejected',
            handler: typeof onRejected === 'function' ? onRejected : undefined,
            result,
        })
        return result.promise
    }

    private initializePromiseObject(promise: object): VmPromiseRecord {
        markVmOwned(promise)
        const record: VmPromiseRecord = {
            id: this.nextPromiseId++,
            promise,
            state: 'pending',
            value: undefined,
            fulfillReactions: [],
            rejectReactions: [],
        }
        this.promiseRecords.set(promise, record)
        this.promises.push(record)
        return record
    }

    private createPromiseRecord(): VmPromiseRecord {
        return this.initializePromiseObject(Object.create(this.promisePrototype))
    }

    private promiseRecordFor(value: unknown): VmPromiseRecord | undefined {
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
            return undefined
        }
        return this.promiseRecords.get(value as object)
    }

    private resolveRecord(record: VmPromiseRecord, value: unknown) {
        if (record.state !== 'pending') {
            return
        }
        if (value === record.promise) {
            this.rejectRecord(record, new TypeError('Cannot resolve promise with itself'))
            return
        }
        const adopted = this.promiseRecordFor(value)
        if (adopted) {
            this.addReaction(adopted, { type: 'then', kind: 'fulfilled', handler: undefined, result: record })
            this.addReaction(adopted, { type: 'then', kind: 'rejected', handler: undefined, result: record })
            return
        }
        this.fulfillRecord(record, value)
    }

    private fulfillRecord(record: VmPromiseRecord, value: unknown) {
        this.settleRecord(record, 'fulfilled', value, record.fulfillReactions)
    }

    private rejectRecord(record: VmPromiseRecord, reason: unknown) {
        this.settleRecord(record, 'rejected', reason, record.rejectReactions)
    }

    private settleRecord(
        record: VmPromiseRecord,
        state: Exclude<VmPromiseState, 'pending'>,
        value: unknown,
        reactions: VmPromiseReaction[]
    ) {
        if (record.state !== 'pending') {
            return
        }
        record.state = state
        record.value = value
        record.fulfillReactions = []
        record.rejectReactions = []
        for (const reaction of reactions) {
            this.enqueueReaction(reaction, value)
        }
    }

    private addReaction(record: VmPromiseRecord, reaction: VmPromiseReaction) {
        if (record.state === 'pending') {
            if (reaction.kind === 'fulfilled') {
                record.fulfillReactions.push(reaction)
            } else {
                record.rejectReactions.push(reaction)
            }
            return
        }
        if (
            (record.state === 'fulfilled' && reaction.kind === 'fulfilled')
            || (record.state === 'rejected' && reaction.kind === 'rejected')
        ) {
            this.enqueueReaction(reaction, record.value)
        }
    }

    private enqueueReaction(reaction: VmPromiseReaction, argument: unknown) {
        if (reaction.type === 'then') {
            this.jobs.push({
                id: this.nextJobId++,
                type: 'then',
                reaction,
                argument,
            })
        } else {
            this.jobs.push({
                id: this.nextJobId++,
                type: 'asyncContinuation',
                task: reaction.task,
                kind: reaction.kind,
                argument,
            })
        }
    }

    private runMain() {
        const result = this.runExecution(this.mainExecution)
        if (result.done) {
            this.mainDoneValue = true
        }
    }

    private runActiveJob() {
        const job = this.activeJob
        if (!job) {
            return
        }

        if (job.type === 'then') {
            try {
                const completion = this.runReactionJob(job)
                if (!completion.done) {
                    return
                }
                if (completion.rejected) {
                    this.rejectRecord(job.reaction.result, completion.value)
                } else {
                    this.resolveRecord(job.reaction.result, completion.value)
                }
                this.activeJob = null
            } catch (error) {
                this.rejectRecord(job.reaction.result, error)
                this.activeJob = null
            }
            return
        }

        try {
            if (!this.runAsyncJob(job)) {
                return
            }
            this.activeJob = null
        } catch (error) {
            this.rejectRecord(job.task.promise, error)
            this.forgetAsyncTask(job.task)
            this.activeJob = null
        }
    }

    private runReactionJob(job: VmThenJob): { done: false } | { done: true, rejected: boolean, value: unknown } {
        const { reaction } = job
        if (reaction.handler === undefined) {
            return {
                done: true,
                rejected: reaction.kind === 'rejected',
                value: job.argument,
            }
        }

        const descriptor = this.stepableDescriptor(reaction.handler)
        if (!descriptor) {
            return {
                done: true,
                rejected: false,
                value: Reflect.apply(reaction.handler as Function, undefined, [job.argument]),
            }
        }

        if (!job.execution) {
            job.execution = getExecution(
                descriptor[Fields.programSection],
                descriptor[Fields.offset],
                descriptor[Fields.globalThis],
                [...descriptor[Fields.scopes]],
                {
                    [Fields.type]: InvokeType.Apply,
                    [Fields.function]: reaction.handler,
                    [Fields.name]: descriptor[Fields.name],
                    [Fields.self]: undefined,
                },
                [job.argument],
                this.getDebugFunction,
                this.compileFunction,
                this.functionRedirects,
                null,
                this.admitValue,
                this
            )
        }

        const result = this.runExecution(job.execution)
        if (!result.done) {
            return { done: false }
        }
        return {
            done: true,
            rejected: false,
            value: result.value,
        }
    }

    private runAsyncJob(job: VmAsyncStartJob | VmAsyncContinuationJob): boolean {
        const resume = job.type === 'asyncContinuation'
            ? { kind: job.kind, value: job.argument }
            : undefined
        return this.runAsyncTask(job.task, resume)
    }

    private runAsyncTask(
        task: VmAsyncTask,
        resume?: { kind: VmPromiseReactionKind, value: unknown }
    ): boolean {
        if (resume) {
            if (resume.kind === 'fulfilled') {
                task.execution[Fields.pushValue](resume.value)
            } else {
                task.execution[Fields.setPendingThrow](resume.value)
            }
        }

        const result = this.runExecutionUntilAwait(task.execution)
        if (result.kind === 'paused') {
            return false
        }
        if (result.kind === 'done') {
            this.resolveRecord(task.promise, result.value)
            this.forgetAsyncTask(task)
            return true
        }

        this.attachAwaitContinuation(task, result.value)
        return true
    }

    private forgetAsyncTask(task: VmAsyncTask) {
        const index = this.asyncTasks.indexOf(task)
        if (index >= 0) {
            this.asyncTasks.splice(index, 1)
        }
    }

    private attachAwaitContinuation(task: VmAsyncTask, value: unknown) {
        const awaited = this.awaitableRecord(value)
        this.addReaction(awaited, { type: 'await', kind: 'fulfilled', task })
        this.addReaction(awaited, { type: 'await', kind: 'rejected', task })
    }

    private awaitableRecord(value: unknown): VmPromiseRecord {
        const existing = this.promiseRecordFor(value)
        if (existing) {
            return existing
        }

        if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
            try {
                const then = Reflect.get(value as object, 'then')
                if (typeof then === 'function') {
                    const rejected = this.createPromiseRecord()
                    this.rejectRecord(rejected, this.hostPromisePolicy.createHostThenableRejection(value))
                    return rejected
                }
            } catch (error) {
                const rejected = this.createPromiseRecord()
                this.rejectRecord(rejected, this.hostPromisePolicy.createHostThenableRejection(value, error))
                return rejected
            }
        }

        const fulfilled = this.createPromiseRecord()
        this.resolveRecord(fulfilled, value)
        return fulfilled
    }

    private stepableDescriptor(value: unknown): FunctionDescriptor | undefined {
        const descriptor = functionDescriptors.get(value)
        if (!descriptor || isAsyncType(descriptor[Fields.type])) {
            return undefined
        }
        return descriptor
    }

    private runExecutionUntilAwait(execution: Execution): (
        | { kind: 'paused' }
        | { kind: 'done', value: unknown }
        | { kind: 'await', value: unknown }
    ) {
        let result: Result
        do {
            result = execution[Fields.step]()
            if (this.pausedValue) {
                return { kind: 'paused' }
            }
            if (!result[Fields.done] && result[Fields.yield]) {
                throw new Error('Unhandled yield in VM async session task')
            }
            if (!result[Fields.done] && result[Fields.await]) {
                return { kind: 'await', value: (result as ResultAwait)[Fields.value] }
            }
        } while (!result[Fields.done])
        return {
            kind: 'done',
            value: (result as any)[Fields.value],
        }
    }

    private runExecution(execution: Execution): { done: false } | { done: true, value: unknown } {
        let result: Result
        do {
            result = execution[Fields.step]()
            if (this.pausedValue) {
                return { done: false }
            }
            if (!result[Fields.done] && (result[Fields.await] || result[Fields.yield])) {
                throw new Error('Unhandled suspension in VM async session job')
            }
        } while (!result[Fields.done])
        return {
            done: true,
            value: (result as any)[Fields.value],
        }
    }

    private result(): VmAsyncSessionRunResult {
        return {
            paused: this.pausedValue,
            mainDone: this.mainDoneValue,
            queuedJobs: this.jobs.length + (this.activeJob ? 1 : 0),
            pendingTimers: this.timers.length,
        }
    }
}

export const createVmAsyncSession = (program: number[], options: VmAsyncSessionOptions) =>
    new VmAsyncSession(program, options)

export const createRestoredVmAsyncSession = (options: VmAsyncSessionRestoreShellOptions = {}) =>
    new VmAsyncSession([], {
        globalThis: options.globalThis ?? Object.create(globalThis),
        compileFunction: options.compileFunction,
        functionRedirects: options.functionRedirects,
        admitValue: options.admitValue,
        hostPromisePolicy: options.hostPromisePolicy,
        onPause: options.onPause,
    }, { skipMainExecution: true })
