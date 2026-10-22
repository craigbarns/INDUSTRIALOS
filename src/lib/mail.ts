import nodemailer from "nodemailer";
import { AppError } from "./errors";

export async function sendVerificationMail(email: string, url: string) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Email verification requires the workspace administrator to configure SMTP.");
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? "587"), secure: process.env.SMTP_SECURE === "true",
    requireTLS: process.env.SMTP_SECURE !== "true",
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10000, socketTimeout: 10000,
  });
  try { await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: "Verify your Industrial OS email", text: `Verify your email to access Industrial OS invitations.\n\n${url}\n\nIf you did not request this email, ignore it.` }); }
  catch { throw new AppError(503, "EMAIL_UNAVAILABLE", "The verification email could not be sent. Please try again later."); }
  finally { transport.close(); }
}
