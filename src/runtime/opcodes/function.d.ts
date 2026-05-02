import { OpCode } from "../../compiler";
import { type OpcodeHandlerResult, type RuntimeOpcodeContext } from "./types";
export declare const handleFunctionOpcode: (command: OpCode, ctx: RuntimeOpcodeContext) => OpcodeHandlerResult;
