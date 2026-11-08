export interface Env {
  DB: D1Database;
  UPLOADS?: R2Bucket;
  ASSETS?: Fetcher;
  APP_URL: string;
  ENVIRONMENT?: string;
  DELIVERY_KEY: string;   // base64 32 bytes, AES-256-GCM key for delivery data (secret)
  SETUP_TOKEN?: string;   // one-time super admin setup secret
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  [k: string]: unknown;
}
export type AuthUser = { id: string; email: string; full_name: string; phone: string | null; status: string; csrf: string; perms: string[]; roles: string[] };
export type AppVars = { user: AuthUser | null };
