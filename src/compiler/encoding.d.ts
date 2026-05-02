import * as ts from 'typescript';
import type { Op, Segment } from './codegen';
export declare function genOffset(nodes: Segment): void;
/** Append encoded literals to the tail of `programData` and map temp slot indices to absolute positions. Only scans the code prefix `codeLen`. */
export declare function finalizeLiteralPool(programData: number[], literalValues: any[]): void;
export declare function generateData(seg: Segment, fnRootToSegment: Map<ts.Node, Segment>, fnRootToBodyStart: Map<ts.Node, Op>, programData: number[], literalValues: any[]): void;
/**
 * Walks encoded program words `[0, codeLength)` and returns distinct opcode values present
 * (including {@link OpCode.Literal} where a literal opcode word appears).
 */
export declare function collectUsedOpcodes(programData: number[], codeLength: number): number[];
