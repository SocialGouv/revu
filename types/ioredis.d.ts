declare module 'ioredis' {
  // Minimal stub to satisfy Probot's type import
  export interface RedisOptions {
    // Keep broad to avoid adding a runtime dependency
    [key: string]: unknown
  }
}
