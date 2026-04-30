
declare module '*.vue' {
    const component: import('vue').DefineComponent<{}, {}, any>
    export default component
}
