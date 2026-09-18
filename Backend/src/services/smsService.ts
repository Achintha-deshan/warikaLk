import { env } from '../config/env';

interface FitSmsResponse {
  status?: string;
  message?: string;
  [key: string]: unknown;
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function sendSmsViaFitSms(recipient: string, message: string): Promise<FitSmsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch('https://app.fitsms.lk/api/v4/sms/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.FITSMS_API_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        recipient, // Format: 94771234567
        sender_id: env.FITSMS_SENDER_ID,
        type: 'plain',
        message,
        expiry_time: 3600,
      }),
      signal: controller.signal,
    });

    const data = (await response.json()) as FitSmsResponse;

    if (!response.ok) {
      console.error('Fit SMS API Error Response:', data);
      throw new Error(data.message || 'Failed to send SMS via Fit SMS.');
    }

    return data;
  } catch (err) {
    const messageText = err instanceof Error ? err.message : 'Failed to send SMS via Fit SMS.';
    console.error('Fit SMS Error:', messageText);
    throw new Error(messageText);
  } finally {
    clearTimeout(timeout);
  }
}
