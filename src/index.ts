import { config } from 'dotenv'
import express from 'express'
import { logSystemError } from './utils/logger.js'
import { container } from './container.ts'
import type { WebhookApp } from './core/utils/platform.ts'

// Load environment variables
config()

const app = express()
app.disable('x-powered-by') // Désactive l'en-tête X-Powered-By pour la sécurité
const port = parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '0.0.0.0' // Important pour Docker !

async function startServer() {
  try {

    const webhookApp = container.resolve<WebhookApp>('WebhookApp')
    app.use(webhookApp.router)
    // Middleware pour JSON
    app.use(express.json())

    // Health check route
    app.get('/healthz', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
    })

    // Démarrer le serveur
    app.listen(port, host, () => {
      console.log(`🤖 Revu server listening on ${host}:${port}`)
    })
  } catch (error) {
    logSystemError(error, {
      context_msg: 'Failed to start server'
    })
    process.exit(1)
  }
}

// Démarrer le serveur
startServer()
