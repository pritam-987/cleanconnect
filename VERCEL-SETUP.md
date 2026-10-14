# Deploy CleanConnect on Vercel (free)

Deploy THIS folder (the one containing `api/`, `public/` and `package.json`), not the parent folder.

1. Put this folder in a GitHub repository (or deploy it with the Vercel CLI: `npx vercel` from inside this folder).
2. In Vercel, import the repository. Framework preset: **Other**. Leave build settings empty.
3. In your Vercel project, open **Storage** and create or connect a **Neon** (Postgres) database. Vercel adds the `DATABASE_URL` setting for you.
4. Open **Settings > Environment Variables** and add two:
   - `ADMIN_PASSWORD` (8+ characters)
   - `TEAM_PASSWORD` (8+ characters, shared by the three team accounts)
5. **Redeploy** (Deployments > the latest one > Redeploy). Settings only apply to new deployments.
6. Check `https://YOUR-SITE.vercel.app/api/meta`. You should see JSON with `"staffAccountsReady":true`.

## Logins
- Admin: `admin@demo.local` / your ADMIN_PASSWORD
- Teams: `t1@demo.local` (Riverside), `t2@demo.local` (Old Market), `t3@demo.local` (Hillview) / your TEAM_PASSWORD
- Residents: create an account on the Sign in page.

Staff accounts are created once, the first time the site runs with both passwords set. Changing the variables later does not change existing passwords.

## Limits to know about
- Photo uploads must stay small (the site shrinks them in the browser). Vercel rejects request bodies over about 4.5 MB.
- Two people saving at the exact same moment can overwrite each other's change. Fine for a demo, not for real use.
- Failed-login limiting is per server instance, so it is only best-effort.
- Free-plan limits and terms (Vercel Hobby, Neon free tier) can change. Check them before relying on this.
