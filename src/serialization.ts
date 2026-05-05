export {
    createVmAsyncSession,
    VmAsyncSession,
    type VmAsyncSessionAdvanceResult,
    type VmAsyncSessionOptions,
    type VmAsyncSessionPauseInfo,
    type VmAsyncSessionRunResult,
} from "./runtime/async-session"

export {
    createHostRegistry,
    createCheckpointableAdmission,
    createSerializableHostObjectRedirects,
    parseExecutionSnapshot,
    restoreExecution,
    serializeExecutionSnapshot,
    snapshotExecution,
    UnsupportedSerializationError,
    type CheckpointableAdmission,
    type ExecutionSnapshot,
    type HostCapabilityRegistry,
} from "./runtime/serialization"
