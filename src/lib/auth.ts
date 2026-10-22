import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { organization } from "better-auth/plugins";
import { getDb } from "./db";
import { user, session, account, verification, organizations, member, invitation, rateLimit } from "./db/schema";
import { AppError } from "./errors";
import { sendVerificationMail } from "./mail";

export function createAuth(database: Parameters<typeof drizzleAdapter>[0], options: { baseURL: string; secret: string; rateLimiting?: boolean }) {
  return betterAuth({
    appName: "Industrial OS", baseURL: options.baseURL, secret: options.secret,
    trustedOrigins: [options.baseURL],
    database: drizzleAdapter(database, { provider: "pg", schema: { user, session, account, verification, organization: organizations, member, invitation, rateLimit } }),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true" },
    emailVerification: { sendOnSignUp: !!process.env.SMTP_HOST, sendVerificationEmail: async ({ user, url }) => { await sendVerificationMail(user.email, url); } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: options.baseURL.startsWith("https://"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
    rateLimit: { enabled: options.rateLimiting ?? true, storage: "database", window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: 5 }, "/sign-up/email": { window: 60, max: 3 }, "/send-verification-email": { window: 300, max: 3 } } },
    logger: { disabled: true },
    plugins: [organization({ requireEmailVerificationOnInvitation: true, invitationExpiresIn: 60 * 60 * 48, membershipLimit: 250 })],
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) throw new AppError(503, "SETUP_REQUIRED", "Configure an authentication secret with at least 32 characters.");
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  if (process.env.NODE_ENV === "production" && !baseURL.startsWith("https://")) throw new AppError(503, "SETUP_REQUIRED", "Configure the public HTTPS application URL.");
  instance ??= createAuth(getDb(), { baseURL, secret: process.env.BETTER_AUTH_SECRET });
  return instance;
}
