import type { VmAsyncSession, VmAsyncSessionRunResult } from './serialization'

export function continueVmAsyncSession(session: VmAsyncSession): VmAsyncSessionRunResult {
    return session.paused ? session.resume() : session.runUntilIdleOrPause()
}
