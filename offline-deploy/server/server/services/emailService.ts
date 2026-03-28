import nodemailer from "nodemailer";

interface AlertEmailData {
  ruleName: string;
  ruleType: string;
  message: string;
  currentValue: number;
  thresholdValue: number;
}

let transporter: nodemailer.Transporter | null = null;

export function initEmailService() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpFrom = process.env.SMTP_FROM || smtpUser;

  if (!smtpHost || !smtpUser || !smtpPassword) {
    console.log("[Email Service] SMTP not configured, email notifications disabled");
    console.log("[Email Service] Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD to enable");
    return;
  }

  try {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    console.log(`[Email Service] Initialized with ${smtpHost}:${smtpPort}`);
  } catch (error) {
    console.error("[Email Service] Failed to initialize:", error);
    transporter = null;
  }
}

export async function sendAlertEmail(data: AlertEmailData): Promise<boolean> {
  if (!transporter) {
    console.warn("[Email Service] Transporter not initialized, skipping email");
    return false;
  }

  const smtpFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
  const smtpTo = process.env.ALERT_EMAIL_TO || process.env.SMTP_USER;

  if (!smtpTo) {
    console.warn("[Email Service] ALERT_EMAIL_TO not configured, skipping email");
    return false;
  }

  const subject = `🚨 MQTT Alert: ${data.ruleName}`;
  const html = generateAlertEmailHTML(data);

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to: smtpTo,
      subject,
      html,
    });

    console.log(`[Email Service] Alert email sent to ${smtpTo}`);
    return true;
  } catch (error) {
    console.error("[Email Service] Failed to send email:", error);
    return false;
  }
}

function generateAlertEmailHTML(data: AlertEmailData): string {
  const ruleTypeLabels: Record<string, string> = {
    LATENCY_THRESHOLD: "Độ trễ vượt ngưỡng",
    BROKER_DISCONNECT: "Broker ngắt kết nối",
    MESSAGE_FAILURE_RATE: "Tỷ lệ thất bại cao",
    THROUGHPUT_LOW: "Throughput thấp",
    THROUGHPUT_HIGH: "Throughput cao",
    CLIENT_OFFLINE: "Client offline",
  };

  const ruleTypeLabel = ruleTypeLabels[data.ruleType] || data.ruleType;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MQTT Alert</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background-color: #ffffff;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #ef4444;
      color: white;
      padding: 20px;
      border-radius: 8px 8px 0 0;
      margin: -30px -30px 20px -30px;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .alert-type {
      display: inline-block;
      background-color: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 14px;
      margin-top: 8px;
    }
    .content {
      margin: 20px 0;
    }
    .metric {
      background-color: #f9fafb;
      border-left: 4px solid #ef4444;
      padding: 16px;
      margin: 16px 0;
      border-radius: 4px;
    }
    .metric-label {
      font-size: 12px;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .metric-value {
      font-size: 24px;
      font-weight: 700;
      color: #1f2937;
    }
    .message {
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      padding: 16px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
    .button {
      display: inline-block;
      background-color: #3b82f6;
      color: white;
      padding: 12px 24px;
      text-decoration: none;
      border-radius: 6px;
      margin-top: 20px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 MQTT Alert Triggered</h1>
      <div class="alert-type">${ruleTypeLabel}</div>
    </div>
    
    <div class="content">
      <h2>${data.ruleName}</h2>
      
      <div class="message">
        <strong>Alert Message:</strong><br>
        ${data.message}
      </div>
      
      <div class="metric">
        <div class="metric-label">Current Value</div>
        <div class="metric-value">${data.currentValue.toFixed(2)}</div>
      </div>
      
      <div class="metric">
        <div class="metric-label">Threshold</div>
        <div class="metric-value">${data.thresholdValue.toFixed(2)}</div>
      </div>
      
      <p>
        <strong>Time:</strong> ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}
      </p>
      
      <a href="${process.env.VITE_FRONTEND_FORGE_API_URL || 'http://localhost:3000'}/mqtt-alerts" class="button">
        View Alert Dashboard
      </a>
    </div>
    
    <div class="footer">
      <p>This is an automated alert from AVI/AOI Management System</p>
      <p>To configure alert settings, visit the MQTT Alert Rules page</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

// Initialize on module load
initEmailService();
