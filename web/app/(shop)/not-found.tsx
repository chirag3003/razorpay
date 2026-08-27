// The root not-found.tsx handles URLs that match no route at all (and renders
// without site chrome). This copy is what `notFound()` inside a shop segment —
// products/[slug] and categories/[slug] — resolves to, so those keep the
// Header/Footer. Same UI, one source.
export { default } from "../not-found";
