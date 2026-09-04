import { z } from "zod";
import { openrouter, modelChain } from "../clients/openrouter";
import { searchFiltersSchema, type SearchFilters } from "../schemas/agent-tool.schema";

// One non-streaming completion turning free text into the structured filters search_products
// already accepts. Here rather than in the tool handler per LLM Isolation; searchAssistService is
// the only caller. Never throws — every failure resolves to {} for the caller to degrade from.

const filtersJsonSchema = z.toJSONSchema(searchFiltersSchema, { io: "output" }) as Record<
  string,
  unknown
>;
delete filtersJsonSchema.$schema;

function isEventStream(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

/** What the model needs to pick a category: the slug it must emit, plus what that slug means. */
export type CategoryHint = { slug: string; name: string; description: string };

function systemPrompt(categories: CategoryHint[]) {
  // One line per category, `slug — name — description`. Slugs alone left the model inferring that
  // "milk" belongs to `dairy-eggs` from the slug string itself.
  const catalog = categories
    .map((c) => `  ${c.slug} — ${c.name} — ${c.description}`)
    .join("\n");

  return (
    "You turn a shopper's free-text request into structured catalog filters for a grocery " +
    "store. Only use category slugs from this exact list — never invent one, and emit the slug, " +
    "not the name:\n" +
    `${catalog}\n` +
    "If nothing in the request clearly maps to a filter, omit that field rather than guessing. " +
    "Respond with only the JSON object, no other text."
  );
}

export async function buildSearchFilters(
  freeText: string,
  categories: CategoryHint[]
): Promise<Partial<SearchFilters>> {
  try {
    const response = await openrouter.chat.send({
      chatRequest: {
        model: modelChain[0],
        models: modelChain.length > 1 ? modelChain : undefined,
        messages: [
          { role: "system", content: systemPrompt(categories) },
          { role: "user", content: freeText },
        ],
        temperature: 0,
        // Some OpenRouter models make reasoning mandatory and reject reasoningEffort "none", so
        // the budget must cover a reasoning trace *and* the JSON answer. Too low and the model
        // spends it all thinking, returning finishReason "length" with null content.
        maxTokens: 1200,
        stream: false,
        responseFormat: {
          type: "json_schema",
          jsonSchema: { name: "search_filters", schema: filtersJsonSchema, strict: true },
        },
      },
    });

    if (isEventStream(response)) return {};

    const message = response.choices?.[0]?.message;
    const raw = message?.content;
    const text = typeof raw === "string" ? raw : Array.isArray(raw) ? "" : "";
    if (!text) return {};

    const parsed = searchFiltersSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    // Provider error, rate limit, malformed JSON — all degrade to "no filters derived". The
    // caller falls back to a plain keyword search.
    return {};
  }
}
