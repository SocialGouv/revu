import dotenv from 'dotenv'
import { Probot, run } from 'probot'
import handlePullRequest from './pull-request-handler.js'

dotenv.config()

async function app(probot: Probot): Promise<void> {
  console.log('🚀 Starting Revu bot...')
  
  probot.on(['pull_request.opened', 'pull_request.synchronize'], async (context: any) => {
    console.log(`📥 Received PR event: ${context.payload.action}
    Repository: ${context.payload.repository.full_name}
    PR #${context.payload.pull_request.number}
    `)
    
    await handlePullRequest(context)
  })
  
  console.log('✅ Revu bot initialized and ready for PR reviews')
}

run(app).catch((error) => {
  console.error('Failed to start Probot:', error)
  process.exit(1)
})
