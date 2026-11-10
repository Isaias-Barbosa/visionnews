import './build.mjs';
import {cpSync,rmSync} from 'node:fs';
cpSync('public','dist/vercel',{recursive:true});
// These documents must pass through the authorization handler.
rmSync('dist/vercel/admin/index.html');
rmSync('dist/vercel/dashboard/index.html');
if (process.env.VERCEL_ENV==='production' && process.env.DATABASE_URL) {
 const {migrate} = await import('./migrate-postgres.mjs');
 await migrate();
}
