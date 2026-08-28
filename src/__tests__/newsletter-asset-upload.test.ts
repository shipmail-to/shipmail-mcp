import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { describe, expect, test } from "bun:test";
import { ShipmailClient } from "shipmail";

import { newsletterAssetUploadPreparationOutputSchema } from "../schemas.js";
import { registerTools } from "../tools.js";

type TestFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function buildPair(testFetch: TestFetch) {
  const fetchImpl = Object.assign(testFetch, { preconnect() {} });
  const shipmail = new ShipmailClient({
    apiKey: "sk_test",
    baseUrl: "https://shipmail.to/api/v1",
    maxRetries: 0,
    fetch: fetchImpl,
  });
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, shipmail, new Set(["shipmail_prepare_newsletter_asset_upload"]));
  const client = new Client({ name: "test-client", version: "0.0.0" });
  return { server, client };
}

async function connectPair(server: McpServer, client: Client): Promise<void> {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

describe("newsletter asset upload", () => {
  test("returns a one-time upload contract without exposing the connection credential", async () => {
    const uploadUrl = "https://r2.example/newsletter-images/org_123/upload_token.png?signed=put";
    const completeUrl = "https://shipmail.to/api/v1/newsletter-asset-uploads/upload_token";
    const { server, client } = buildPair(async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/newsletter-assets/upload-tokens");
      expect(init?.method).toBe("POST");
      return Response.json({
        object: "newsletter_asset_upload",
        kind: "image",
        filename: "hero.png",
        content_type: "image/png",
        size: 123,
        sha256: "a".repeat(64),
        upload_url: uploadUrl,
        upload_method: "PUT",
        upload_headers: {
          "Content-Type": "image/png",
          "If-None-Match": "*",
        },
        complete_url: completeUrl,
        complete_method: "POST",
        expires_at: "2026-08-08T12:05:00.000Z",
      });
    });
    await connectPair(server, client);

    const result = await client.callTool({
      name: "shipmail_prepare_newsletter_asset_upload",
      arguments: {
        filename: "hero.png",
        content_type: "image/png",
        size: 123,
        sha256: "a".repeat(64),
      },
    });

    expect(result.isError).toBeFalsy();
    const output = newsletterAssetUploadPreparationOutputSchema.parse(result.structuredContent);
    expect(output.prepared_upload).toMatchObject({
      kind: "image",
      upload_url: uploadUrl,
      upload_method: "PUT",
      complete_url: completeUrl,
      complete_method: "POST",
    });
    expect(result._meta).toMatchObject({ upload_url: uploadUrl, complete_url: completeUrl });
  });
});
