export declare enum EntryType {
    stringKeyProp = 0,
    stringKeyGetSet = 1,
    stringKeyError = 2,
    symbolKeyProp = 3,
    symbolKeyGetSet = 4,
    symbolKeyError = 5,
    prototype = 6
}
declare const _default: import("vue").DefineComponent<import("vue").ExtractPropTypes<{
    initialExpand: {
        type: BooleanConstructor;
        default: boolean;
    };
    isError: {
        type: BooleanConstructor;
        default: boolean;
    };
    displayKey: {
        type: StringConstructor;
        default: null;
    };
    forcedProp: {
        type: BooleanConstructor;
        default: boolean;
    };
    scopeValue: {
        type: BooleanConstructor;
        default: boolean;
    };
    scopeDebugNames: {
        type: () => string[];
        default: () => never[];
    };
    refreshKey: {
        type: NumberConstructor;
        default: number;
    };
    value: {};
}>, {}, {
    expand: boolean;
    EntryType: typeof EntryType;
}, {
    type(): string;
    serialized(): string;
    childEntries(): [EntryType, string | symbol, unknown | PropertyDescriptor][];
}, {
    wrapIdentifier(str: string): string;
}, import("vue").ComponentOptionsMixin, import("vue").ComponentOptionsMixin, {}, string, import("vue").PublicProps, Readonly<import("vue").ExtractPropTypes<{
    initialExpand: {
        type: BooleanConstructor;
        default: boolean;
    };
    isError: {
        type: BooleanConstructor;
        default: boolean;
    };
    displayKey: {
        type: StringConstructor;
        default: null;
    };
    forcedProp: {
        type: BooleanConstructor;
        default: boolean;
    };
    scopeValue: {
        type: BooleanConstructor;
        default: boolean;
    };
    scopeDebugNames: {
        type: () => string[];
        default: () => never[];
    };
    refreshKey: {
        type: NumberConstructor;
        default: number;
    };
    value: {};
}>> & Readonly<{}>, {
    initialExpand: boolean;
    isError: boolean;
    displayKey: string;
    forcedProp: boolean;
    scopeValue: boolean;
    scopeDebugNames: string[];
    refreshKey: number;
}, {}, {}, {}, string, import("vue").ComponentProvideOptions, true, {}, any>;
export default _default;
