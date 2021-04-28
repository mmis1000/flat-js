import App from './index.vue'
import Vue from 'vue'

try {
    eval('console.log("CSP does not work")')
} catch (err) {
    console.log("CSP do work")
}

new Vue({
    el: document.getElementById('main')!,
    data: {},
    render: (h) => h(App)
})