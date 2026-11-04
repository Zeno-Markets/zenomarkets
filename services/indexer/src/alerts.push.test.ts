import assert from "node:assert/strict";
import { createECDH, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import webpush from "web-push";
import { webPushSender } from "./alerts.js";

/// The server half of "the browser is closed": a real `web-push` request to a stand-in push service, decrypted the
/// way a browser would (RFC 8291, `aes128gcm`) with the subscriber's own keys. No page, service worker or browser is
/// involved, so passing here means the alert reaches the push service without anyone having the site open.
function pushService(status: () => number) {
  const dir = mkdtempSync(join(tmpdir(), "push-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const received: { headers: Record<string, string | string[] | undefined>; body: Buffer }[] = [];
  const server = createServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.statusCode = status();
      response.end();
    });
  });
  return new Promise<{ endpoint: string; received: typeof received; close: () => void }>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ endpoint: `https://127.0.0.1:${(server.address() as AddressInfo).port}/send/abc`, received, close: () => server.close() })),
  );
}

const b64 = (buffer: Buffer) => buffer.toString("base64url");

/// RFC 8291 section 3.4 and RFC 8188: what the browser does with the body it receives.
function decrypt(body: Buffer, subscriber: ReturnType<typeof createECDH>, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20] as number;
  const serverPublic = body.subarray(21, 21 + idLength);
  const secret = subscriber.computeSecret(serverPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), subscriber.getPublicKey(), serverPublic]);
  const key = Buffer.from(hkdfSync("sha256", secret, auth, info, 32));
  const cek = Buffer.from(hkdfSync("sha256", key, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", key, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const sealed = body.subarray(21 + idLength);
  const decipher = createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  return plain.subarray(0, plain.lastIndexOf(2)).toString("utf8");
}

test("a fired alert is sent to the push service, encrypted for the subscriber, with no browser open; 410 means gone", async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // the stand-in service has a self-signed certificate
  let status = 201;
  const service = await pushService(() => status);
  const subscriber = createECDH("prime256v1");
  subscriber.generateKeys();
  const auth = randomBytes(16);
  const target = { endpoint: service.endpoint, p256dh: b64(subscriber.getPublicKey()), auth: b64(auth) };
  const keys = webpush.generateVAPIDKeys();
  const send = webPushSender({ subject: "https://example.com", publicKey: keys.publicKey, privateKey: keys.privateKey });

  const payload = JSON.stringify({ title: "NVDA at or above $200.00", body: "Now $201.20.", url: "/alerts", tag: "alert-1" });
  assert.equal(await send(target, payload), "sent");
  const [request] = service.received;
  assert.ok(request);
  assert.equal(request.headers["content-encoding"], "aes128gcm");
  assert.match(String(request.headers.authorization), /^vapid t=.+, k=.+$/);
  assert.ok(String(request.headers.authorization).includes(keys.publicKey));
  assert.equal(decrypt(request.body, subscriber, auth), payload);

  status = 410;
  assert.equal(await send(target, payload), "gone");
  status = 404;
  assert.equal(await send(target, payload), "gone");
  status = 500;
  assert.equal(await send(target, payload), "failed");
  service.close();
});
