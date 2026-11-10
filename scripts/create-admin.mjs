import { createPool } from '../server/postgres.mjs';
import { createAuth } from '../server/accounts.mjs';

const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password=process.env.ADMIN_INITIAL_PASSWORD;
const origin=process.env.BETTER_AUTH_URL;
const secret=process.env.BETTER_AUTH_SECRET;
if (!email || !password || password.length<12 || !origin || !secret) {
 throw Error('Configure ADMIN_EMAIL, ADMIN_INITIAL_PASSWORD (12+ caracteres), BETTER_AUTH_URL e BETTER_AUTH_SECRET.');
}
const pool=createPool();
try {
 const existing=await pool.query('SELECT id FROM "user" WHERE email=$1',[email]);
 if (existing.rowCount) throw Error('O e-mail já existe. Revise a conta antes de conceder acesso administrativo.');
 const auth=createAuth(pool,origin,secret);
 const {user}=await auth.api.signUpEmail({body:{name:'Administração VisionNews',email,password}});
 await pool.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1',[user.id]);
 console.log('Conta administrativa criada.');
} finally {
 await pool.end();
}
