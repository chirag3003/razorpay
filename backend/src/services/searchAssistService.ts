import * as categoryService from "./categoryService";
import { buildSearchFilters } from "../llm/searchQueryBuilder";
import type { SearchFilters } from "../schemas/agent-tool.schema";

// Advisory only: turns free text into search filters, never touches cart/checkout/payment.
// On backend/CLAUDE.md's LLM Isolation allow-list under the same framing as growthService.
export async function buildSearchFiltersFromText(freeText: string): Promise<Partial<SearchFilters>> {
  const categories = await categoryService.listCategories();
  return buildSearchFilters(
    freeText,
    categories.map((c) => c.slug)
  );
}
