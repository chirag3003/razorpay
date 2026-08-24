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
