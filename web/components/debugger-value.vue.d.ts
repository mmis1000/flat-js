import Vue from 'vue';
declare enum EntryType {
    stringKeyProp = 0,
    stringKeyGetSet = 1,
    stringKeyError = 2,
    symbolKeyProp = 3,
    symbolKeyGetSet = 4,
    symbolKeyError = 5,
    prototype = 6
}
declare const _default: import("vue/types/vue").ExtendedVue<Vue, {
    expand: boolean;
    EntryType: typeof EntryType;
}, {
    wrapIdentifier(str: string): string;
}, {
    type: string;
    serialized: string;
    childEntries: [EntryType, string | symbol, unknown][];
}, {
    initialExpand: boolean;
    isError: boolean;
    displayKey: string;
    forcedProp: boolean;
    refreshKey: number;
    value: unknown;
}>;
export default _default;
