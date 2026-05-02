/**
 * Removes dead opcode `case` arms from the compiled runtime's outer `command: switch`
 * and the per-family handler `switch (command)` bodies. Preserves `default` and
 * non-numeric cases.
 */
export declare function stripRuntimeCommandSwitch(source: string, keepOpcodeValues: Set<number>): string;
