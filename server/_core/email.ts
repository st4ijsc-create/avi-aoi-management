import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/**
 * Initialize email transporter with SMTP configuration
 * Uses environment variables for configuration
 */
export function initializeEmailTransporter() {
  const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpUser || !smtpPass) {
    console.warn("[Email] SMTP credentials not configured. Email sending will be disabled.");
    return null;
  }

  try {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    console.log(`[Email] Transporter initialized with ${smtpHost}:${smtpPort}`);
    return transporter;
  } catch (error) {
    console.error("[Email] Failed to initialize transporter:", error);
    return null;
  }
}

/**
 * Get the email transporter instance
 */
export function getEmailTransporter(): Transporter | null {
  if (!transporter) {
    transporter = initializeEmailTransporter();
  }
  return transporter;
}

/**
 * Send an email
 */
export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string;
  }>;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const emailTransporter = getEmailTransporter();
  
  if (!emailTransporter) {
    return {
      success: false,
      error: "Email transporter not configured",
    };
  }

  const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    const info = await emailTransporter.sendMail({
      from: smtpFrom,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      attachments: options.attachments,
    });

    console.log(`[Email] Sent to ${options.to}: ${info.messageId}`);
    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: any) {
    console.error("[Email] Failed to send:", error);
    return {
      success: false,
      error: error.message || "Unknown error",
    };
  }
}

/**
 * Verify SMTP connection
 */
export async function verifyEmailConnection(): Promise<boolean> {
  const emailTransporter = getEmailTransporter();
  
  if (!emailTransporter) {
    return false;
  }

  try {
    await emailTransporter.verify();
    console.log("[Email] SMTP connection verified");
    return true;
  } catch (error) {
    console.error("[Email] SMTP connection failed:", error);
    return false;
  }
}
