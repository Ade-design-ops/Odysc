import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/errors.js";
import {
  clubFinderSchema, recommendClubs, type CatalogClub, type ClubFinderInput,
} from "../src/club-finder.js";
import { pdfFixture } from "./fixtures/pdf.js";
import { MAX_RESUME_BYTES } from "../src/resume.js";

const input: ClubFinderInput = {
  profile: { major: "Engineering", interests: ["robotics"], skills: "Python" },
  resume: { fileName: "PRIVATE_NAME-resume.pdf", mediaType: "application/pdf", data: Buffer.from(pdfFixture({ text: "Skills: Python" })).toString("base64") },
  history: [],
};
const clubs: CatalogClub[] = Array.from({ length: 7 }, (_, index) => ({
  id: String(index + 1), name: "Verified club " + (index + 1),
  category: "Engineering", tags: ["robotics"], description: "Student robotics projects.",
  selectivity: "Unknown",
}));
const match = (clubId = "1") => ({ clubId, reason: "Your Python skills connect with robotics projects.", fit: "strong" as const });
const envelope = (text: unknown, extra: Record<string, unknown> = {}) => ({
  type: "message", role: "assistant", stop_reason: "end_turn",
  content: [{ type: "text", text: typeof text === "string" ? text : JSON.stringify(text) }],
  ...extra,
});
const response = (value: unknown) => Response.json(value);
const fetchReply = (value: unknown): typeof fetch => async () => response(value);
const isError = (status: number, code: string) => (error: unknown) =>
  error instanceof HttpError && error.statusCode === status && error.code === code;

test("browser schema accepts bounded alternating history and rejects private profile/file/summary overrides", () => {
  assert.deepEqual(clubFinderSchema.parse({}), { history: [] });
  const history = [{ role: "assistant", content: "Try robotics." }, { role: "user", content: "What about service clubs?" }];
  assert.deepEqual(clubFinderSchema.parse({ history }).history, history);
  for (const value of [
    { profile: input.profile }, { resume: input.resume }, { resumeSummary: "I am an expert." },
    { history: [{ role: "user", content: "Start here." }] },
    { history: [{ role: "assistant", content: "Not a completed user turn." }] },
    { history: [...history, ...Array.from({ length: 20 }, () => history[0])] },
    { history: [{ role: "assistant", content: "x".repeat(2001) }, history[1]] },
    { resumeId: "not-a-uuid" },
  ]) assert.equal(clubFinderSchema.safeParse(value).success, false);
  assert.equal(clubFinderSchema.safeParse({ history, resumeId: "11111111-1111-4111-8111-111111111111" }).success, true);
});

test("provider payload contains only the scoped profile and saved PDF, excludes file identity, and preserves follow-up history", async () => {
  let calls = 0;
  const history: ClubFinderInput["history"] = [
    { role: "assistant", content: "Robotics could fit." }, { role: "user", content: "Is service available?" },
  ];
  const result = await recommendClubs({ ...input, history }, clubs, {
    apiKey: "unit-test-provider-key", model: "unit-test-model",
    fetch: async (url, init) => {
      calls++;
      assert.equal(String(url), "https://api.anthropic.com/v1/messages");
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(new Headers(init?.headers).get("x-api-key"), "unit-test-provider-key");
      const body = JSON.parse(String(init?.body));
      assert.equal(body.model, "unit-test-model");
      assert.ok(body.system[0].text.includes("untrusted data"));
      const content = body.messages[0].content;
      assert.deepEqual(content[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.resume.data } });
      assert.deepEqual(JSON.parse(content[1].text).profile, input.profile);
      assert.deepEqual(body.messages.slice(1), history);
      assert.equal(String(init?.body).includes("PRIVATE_NAME"), false, "resume filename is never sent");
      assert.equal(String(init?.body).includes("resumeSummary"), false);
      assert.equal(Object.hasOwn(JSON.parse(content[1].text).profile, "name"), false);
      assert.equal(Object.hasOwn(JSON.parse(content[1].text).profile, "email"), false);
      return response(envelope({ reply: "Robotics fits.", matches: [match()] }));
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { reply: "Robotics fits.", matches: [{ ...match(), name: "Verified club 1" }] });
  assert.equal(Object.hasOwn(result, "resumeSummary"), false);
});

test("only catalog IDs and trusted names survive, duplicates are removed, and at most five matches return", async () => {
  const result = await recommendClubs(input, clubs, {
    apiKey: "test-key",
    fetch: fetchReply(envelope({
      reply: "An unverified club also fits.",
      matches: [match("made-up"), match("1"), match("1"), ...clubs.slice(1).map((club) => match(club.id))],
    })),
  });
  assert.equal(result.matches.length, 5);
  assert.deepEqual(result.matches.map((item) => item.clubId), ["1", "2", "3", "4", "5"]);
  assert.equal(result.matches[0]!.name, "Verified club 1");
  assert.equal(result.reply.includes("unverified club"), false);
  const unknownOnly = await recommendClubs(input, clubs, {
    apiKey: "test-key", fetch: fetchReply(envelope({ reply: "Invented facts.", matches: [match("missing")] })),
  });
  assert.deepEqual(unknownOnly.matches, []);
  assert.equal(unknownOnly.reply.includes("Invented"), false);
});

test("missing configuration and invalid trusted input fail before any provider request", async () => {
  let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error("should not run"); };
  await assert.rejects(recommendClubs(input, clubs, { apiKey: " ", fetch }), isError(503, "AI_NOT_CONFIGURED"));
  for (const value of [
    { ...input, profile: { ...input.profile, email: "PRIVATE_EMAIL@example.invalid" } },
    { ...input, resume: { ...input.resume, data: Buffer.from("not PDF data").toString("base64") } },
    { ...input, resume: { ...input.resume, data: "invalid base64!" } },
    { ...input, resume: undefined },
  ]) await assert.rejects(recommendClubs(value as unknown as ClubFinderInput, clubs, { apiKey: "test-key", fetch }), isError(400, "AI_INVALID_INPUT"));
  assert.equal(calls, 0);
});

test("empty catalogs return an honest empty result without a provider request", async () => {
  const result = await recommendClubs(input, [], {
    apiKey: "", fetch: async () => { throw new Error("unexpected request"); },
  });
  assert.deepEqual(result.matches, []);
  assert.ok(result.reply.includes("no clubs"));
});

test("provider HTTP errors, redirects and transport failures are sanitized", async () => {
  for (const fetch of [
    (async () => new Response("PRIVATE_PROVIDER_BODY", { status: 429 })) as typeof globalThis.fetch,
    (async () => new Response("PRIVATE_PROVIDER_BODY", { status: 500 })) as typeof globalThis.fetch,
    (async () => new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/" } })) as typeof globalThis.fetch,
    (async () => { throw new Error("PRIVATE_NETWORK_ERROR"); }) as typeof globalThis.fetch,
  ]) {
    await assert.rejects(recommendClubs(input, clubs, { apiKey: "test-key", fetch }), (error) => {
      assert.ok(isError(502, "AI_PROVIDER_ERROR")(error));
      assert.equal(String(error).includes("PRIVATE_"), false);
      return true;
    });
  }
});

test("timeouts are bounded even if an injected transport ignores the abort signal", async () => {
  let signal: AbortSignal | null | undefined;
  await assert.rejects(recommendClubs(input, clubs, {
    apiKey: "test-key", timeoutMs: 5,
    fetch: async (_url, init) => { signal = init?.signal; return new Promise<Response>(() => undefined); },
  }), isError(504, "AI_TIMEOUT"));
  assert.equal(signal?.aborted, true);
});

test("malformed envelopes, refusals, truncated output, tool replies and invalid model JSON fail safely", async () => {
  for (const value of [
    {},
    envelope({ reply: "ok", matches: [] }, { type: "error" }),
    envelope({ reply: "ok", matches: [] }, { stop_reason: "refusal" }),
    envelope({ reply: "ok", matches: [] }, { stop_reason: "max_tokens" }),
    envelope({ reply: "ok", matches: [] }, { content: [{ type: "tool_use", id: "unexpected" }] }),
    envelope("PRIVATE_NOT_JSON"),
    envelope({ reply: "", matches: [] }),
    envelope({ reply: "x".repeat(1501), matches: [] }),
    envelope({ reply: "ok", matches: [{ ...match(), reason: "x".repeat(401) }] }),
    envelope({ reply: "ok", matches: [{ ...match(), fit: "guaranteed admission" }] }),
    envelope({ reply: "ok", matches: [], resumeSummary: "PRIVATE_SUMMARY" }),
  ]) {
    await assert.rejects(recommendClubs(input, clubs, { apiKey: "test-key", fetch: fetchReply(value) }), (error) => {
      assert.ok(isError(502, "AI_INVALID_RESPONSE")(error));
      assert.equal(String(error).includes("PRIVATE_"), false);
      return true;
    });
  }
  await assert.rejects(recommendClubs(input, clubs, {
    apiKey: "test-key", fetch: async () => new Response("<html>PRIVATE_RESPONSE</html>", { headers: { "content-type": "text/html" } }),
  }), isError(502, "AI_INVALID_RESPONSE"));
  await assert.rejects(recommendClubs(input, clubs, {
    apiKey: "test-key", fetch: async () => new Response("{invalid", { headers: { "content-type": "application/json" } }),
  }), isError(502, "AI_INVALID_RESPONSE"));
});

test("fenced JSON is handled only as an outer wrapper and response bytes remain bounded", async () => {
  const output = { reply: "Compare project commitments.", matches: [match()] };
  const result = await recommendClubs(input, clubs, {
    apiKey: "test-key", fetch: fetchReply(envelope("```json\n".replace("\\n", "\n") + JSON.stringify(output) + "\n```")),
  });
  assert.equal(result.matches[0]!.clubId, "1");
  await assert.rejects(recommendClubs(input, clubs, {
    apiKey: "test-key",
    fetch: async () => new Response(" ".repeat(129 * 1024), { headers: { "content-type": "application/json" } }),
  }), isError(502, "AI_INVALID_RESPONSE"));
});



test("Sonnet 5.5 uses its documented low-latency thinking setting", async () => {
  await recommendClubs(input, clubs, {
    apiKey: "test-key", model: "claude-sonnet-5-5",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.thinking, { type: "between_tools" });
      assert.equal(body.output_config.effort, "low");
      assert.equal(body.output_config.format.type, "json_schema");
      const schema = body.output_config.format.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["reply", "matches"]);
      assert.equal(schema.properties.matches.items.additionalProperties, false);
      assert.deepEqual(schema.properties.matches.items.properties.fit.enum, ["strong", "good"]);
      for (const unsupported of ["minLength", "maxLength", "maxItems"]) {
        assert.equal(JSON.stringify(schema).includes('"' + unsupported + '"'), false);
      }
      return response(envelope({ reply: "Robotics fits.", matches: [match()] }));
    },
  });
});


test("full-size saved PDFs are accepted without regex recursion and decoded byte limits remain enforced", async () => {
  const bytes = Buffer.alloc(MAX_RESUME_BYTES, 0x20);
  Buffer.from(pdfFixture()).copy(bytes);
  const large = { ...input, resume: { ...input.resume, data: bytes.toString("base64") } };
  let calls = 0;
  await recommendClubs(large, clubs, {
    apiKey: "test-key",
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      const encoded = body.messages[0].content[0].source.data;
      assert.equal(Buffer.from(encoded, "base64").byteLength, MAX_RESUME_BYTES);
      return response(envelope({ reply: "Robotics fits.", matches: [match()] }));
    },
  });
  const overLimit = { ...input, resume: { ...input.resume, data: Buffer.concat([bytes, Buffer.from(" ")]).toString("base64") } };
  await assert.rejects(recommendClubs(overLimit, clubs, {
    apiKey: "test-key", fetch: async () => { calls++; throw new Error("must not run"); },
  }), isError(400, "AI_INVALID_INPUT"));
  assert.equal(calls, 1);
});


test("native JSON format also applies to configured alternate models without adding Sonnet thinking settings", async () => {
  await recommendClubs(input, clubs, {
    apiKey: "test-key", model: "unit-test-alternate",
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.output_config.format.type, "json_schema");
      assert.equal(Object.hasOwn(body.output_config, "effort"), false);
      assert.equal(Object.hasOwn(body, "thinking"), false);
      return response(envelope({ reply: "Robotics fits.", matches: [match()] }));
    },
  });
});

test("JSON content types with charset and a previously read response clone remain compatible", async () => {
  for (const contentType of ["application/json", "application/json;charset=UTF-8", "Application/JSON; charset=utf-8"]) {
    const result = await recommendClubs(input, clubs, {
      apiKey: "test-key",
      fetch: async () => {
        const original = new Response(JSON.stringify(envelope({ reply: "Robotics fits.", matches: [match()] })), {
          headers: { "content-type": contentType },
        });
        const clone = await original.clone().json();
        assert.equal(clone.stop_reason, "end_turn");
        assert.equal(original.bodyUsed, false);
        return original;
      },
    });
    assert.equal(result.matches[0]!.clubId, "1");
  }
});

test("invalid-response diagnostics expose only a safe internal stage, never provider values", async () => {
  await assert.rejects(recommendClubs(input, clubs, {
    apiKey: "test-key", fetch: fetchReply(envelope({ reply: "PRIVATE_PROVIDER_VALUE", matches: [match()], unexpected: true })),
  }), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, "AI_INVALID_RESPONSE");
    assert.equal((error as HttpError & { stage: string }).stage, "model_schema");
    assert.equal(error.message.includes("model_schema"), false);
    assert.equal(error.message.includes("PRIVATE_PROVIDER_VALUE"), false);
    return true;
  });
});
