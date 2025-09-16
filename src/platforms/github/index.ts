export interface PullRequestOpenedPayload {
  pull_request: {
    number: number
    head: { ref: string }
    user: { login: string; type: string }
  }
}
