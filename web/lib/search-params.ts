import { redirect } from "next/navigation";

export type RawSearchParams = { [key: string]: string | string[] | undefined };

export function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function toSingle(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function toNumber(value: string | string[] | undefined): number | undefined {
  const single = toSingle(value);
  if (single === undefined) return undefined;
  const num = Number(single);
  return Number.isFinite(num) ? num : undefined;
}

export function toURLSearchParams(params: RawSearchParams): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of toArray(value)) {
      search.append(key, v);
    }
  }
  return search;
}

/**
 * `?page=999` used to fetch nothing and then render pagination sitting on the
 * last page with an empty grid between it. Clamp *before* rendering by sending
 * the reader to a page that exists, keeping every other filter intact.
 *
 * Server components only — `redirect` throws to unwind the render.
 */
export function redirectIfPageOutOfRange(
  pathname: string,
  raw: RawSearchParams,
  page: number,
  totalPages: number
): void {
  if (page <= totalPages) return;
  const search = toURLSearchParams(raw);
  search.set("page", String(totalPages));
  redirect(`${pathname}?${search.toString()}`);
}
