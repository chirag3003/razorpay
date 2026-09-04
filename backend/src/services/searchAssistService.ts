import * as categoryService from "./categoryService";
import { buildSearchFilters } from "../llm/searchQueryBuilder";
import type { SearchFilters } from "../schemas/agent-tool.schema";

// Advisory only: turns free text into search filters, never touches cart/checkout/payment.
// On backend/CLAUDE.md's LLM Isolation allow-list under the same framing as growthService.
export async function buildSearchFiltersFromText(freeText: string): Promise<Partial<SearchFilters>> {
  const categories = await categoryService.listCategories();

  // Slug, name AND description. Passing slugs alone made the model map "milk" -> `dairy-eggs`
  // from the slug string by itself; the rows already carry the other two fields, already in
  // memory, so this costs nothing.
  return buildSearchFilters(
    freeText,
    categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description }))
  );
}
