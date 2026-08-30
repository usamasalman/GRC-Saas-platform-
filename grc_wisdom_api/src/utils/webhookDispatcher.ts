import crypto from 'crypto';
import { prisma } from '../db';

/**
 * Outbound webhook dispatch, signed with HMAC SHA-256.
 *
 * Two things were wrong here before. The dispatcher logged the signature and
 * the full payload on every call, so customer document contents and the value
 * that authenticates them both landed in the container logs. And the trigger
 * below posted to a hardcoded partner URL with a hardcoded secret
 * ('partner_secret_12345'), meaning any tenant's published document would have
 * been sent to a third party that no customer had configured.
 *
 * Endpoints now come from the tenant's own WebhookEndpoint rows.
 */

const DELIVERY_TIMEOUT_MS = 10_000;

export const dispatchWebhook = async (
  url: string,
  secret: string,
  eventName: string,
  payload: any,
): Promise<boolean> => {
  const jsonPayload = JSON.stringify({
    event: eventName,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const signature = crypto.createHmac('sha256', secret).update(jsonPayload).digest('hex');

  // The URL is logged because an operator needs to know where a delivery went.
  // The signature and the payload are not: one is a credential, the other is
  // the customer's data.
  console.log(`[Webhook]: dispatching '${eventName}' to ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GRC-Event': eventName,
        'X-GRC-Signature': signature,
      },
      body: jsonPayload,
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(`[Webhook]: ${url} returned ${response.status}`);
      return false;
    }
    return true;
  } catch (error: any) {
    // A partner endpoint being down must never fail the operation that
    // triggered the event.
    console.error(`[Webhook]: delivery to ${url} failed:`, error?.message || error);
    return false;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Fan an event out to every active endpoint the tenant has subscribed to it.
 *
 * Deliveries run concurrently and failures are swallowed by dispatchWebhook, so
 * one unreachable partner cannot hold up or break the caller.
 */
export const triggerTenantEvent = async (
  tenantId: string,
  eventName: string,
  payload: any,
): Promise<number> => {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { tenantId, isActive: true },
    select: { url: true, secret: true, events: true },
  });

  const subscribed = endpoints.filter((e) => {
    try {
      return (JSON.parse(e.events || '[]') as string[]).includes(eventName);
    } catch {
      return false;
    }
  });

  if (subscribed.length === 0) return 0;

  const results = await Promise.all(
    subscribed.map((e) => dispatchWebhook(e.url, e.secret, eventName, payload)),
  );
  return results.filter(Boolean).length;
};

/** Convenience wrapper for the document lifecycle. */
export const triggerDocumentPublishedEvent = async (tenantId: string, documentData: any) =>
  triggerTenantEvent(tenantId, 'document.published', documentData);
