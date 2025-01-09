import dotenv from 'dotenv';
import handlePullRequest from './pull-request-handler.js';
dotenv.config();
export default function (app) {
    app.on(['pull_request.opened', 'pull_request.synchronize'], handlePullRequest);
}
