import { OpCode } from "../../compiler";
import { type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types";
export declare const handleGeneratorOpcode: (command: OpCode, ctx: RuntimeOpcodeContext) => OpcodeHandlerResult;
