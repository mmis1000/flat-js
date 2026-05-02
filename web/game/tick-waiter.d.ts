type TickWaiterOptions = {
    scaledWaitMs: () => number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    fastWakeSlackMs?: number;
    minRealTimeoutMs?: number;
    maxFastWakeStreak?: number;
    forcedTimeoutMs?: number;
};
export declare function createTickWaiter(options: TickWaiterOptions): () => Promise<void>;
export {};
