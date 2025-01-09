import dotenv from 'dotenv';
import { Probot } from 'probot';
import handlePullRequest from './pull-request-handler.js';

dotenv.config();

export default function (app: Probot): void {
  app.on(['pull_request.opened', 'pull_request.synchronize'], handlePullRequest);
}
