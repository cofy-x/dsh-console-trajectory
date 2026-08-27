import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'
import '../theme/design-platform.css'
import '../theme/base.css'
import '../theme/scrollbar.css'
import '../theme/shiki.css'
import './global.css'

const container = document.getElementById('root')
if (container === null) throw new Error('#root missing')
createRoot(container).render(<StrictMode><App /></StrictMode>)
