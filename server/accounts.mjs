import { betterAuth } from 'better-auth';

export function authOptions(pool, baseURL, secret) {
 return {
  database: pool,
  baseURL,
  secret,
  emailAndPassword: { enabled:true, minPasswordLength:12, maxPasswordLength:128 },
  rateLimit: { storage:'database' },
  advanced: { ipAddress: { ipAddressHeaders:['x-vercel-forwarded-for','x-real-ip'] } }
 };
}

export function createAuth(pool, baseURL, secret) {
 return betterAuth(authOptions(pool, baseURL, secret));
}
