import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { SectorProvider } from './contexts/SectorContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SectorProvider>
      <App />
    </SectorProvider>
  </React.StrictMode>,
)
