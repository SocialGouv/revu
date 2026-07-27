import { config } from 'dotenv'
import express from 'express'
import { createNodeMiddleware, createProbot } from 'probot'
import { logSystemError } from './utils/logger.js'
import probotApp from './webhooks.js' // Import de l'app Probot existante
import { getRuntimeConfig } from './core/utils/runtime-config.ts'

// Load environment variables from .env (if present)
config()

const app = express()
app.disable('x-powered-by') // Désactive l'en-tête X-Powered-By pour la sécurité

async function startServer() {
  try {
    const runtime = await getRuntimeConfig()
    const { host, port } = runtime.system

    // Créer le middleware Probot de manière async
    const probotMiddleware = await createNodeMiddleware(probotApp, {
      webhooksPath: '/api/github/webhooks',
      probot: createProbot({
        env: {
          APP_ID: runtime.github.appId,
          PRIVATE_KEY: runtime.github.privateKey,
          WEBHOOK_SECRET: runtime.github.webhookSecret
        }
      })
    })

    // Intégrer Probot
    app.use(probotMiddleware)
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
