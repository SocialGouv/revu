import dotenv from 'dotenv';
import { run } from 'probot';
import handlePullRequest from './pull-request-handler.js';
dotenv.config();
async function app(probot) {
    console.log('🚀 Starting Revu bot...');
    probot.on(['pull_request.opened', 'pull_request.synchronize'], async (context) => {
        console.log(`📥 Received PR event: ${context.payload.action}
    Repository: ${context.payload.repository.full_name}
    PR #${context.payload.pull_request.number}
    `);
        await handlePullRequest(context);
    });
    console.log('✅ Revu bot initialized and ready for PR reviews');
}
run(app).catch((error) => {
    console.error('Failed to start Probot:', error);
    process.exit(1);
});
