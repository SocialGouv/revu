import express from 'express'
import { config } from 'dotenv'
import { createNodeMiddleware, createProbot } from 'probot'
import probotApp from './webhooks.js' // Import de l'app Probot existante
import { logSystemError } from './utils/logger.js'

// Load environment variables
config()

const app = express()
const port = parseInt(process.env.PORT || '3000', 10)
const host = process.env.HOST || '0.0.0.0' // Important pour Docker !

async function startServer() {
  try {
    // Créer le middleware Probot de manière async
    const probotMiddleware = await createNodeMiddleware(probotApp, {
      webhooksPath: '/api/github/webhooks',
      probot: createProbot({
        env: {
          APP_ID: process.env.APP_ID,
          PRIVATE_KEY: process.env.PRIVATE_KEY,
          WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
        },
      }),
    })

    // Middleware pour JSON
    app.use(express.json())

    // Health check route (migré depuis l'ancien addHandler)
    app.get('/healthz', (req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('OK')
    })

    // Intégrer Probot
    app.use(probotMiddleware)

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
