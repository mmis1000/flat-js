import App from './index.vue'
import { createApp } from 'vue'

try {
    eval('console.log("CSP does not work")')
} catch (err) {
    console.log("CSP do work")
}

createApp(App).mount(document.getElementById('main')!)
