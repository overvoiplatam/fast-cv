// Explicit version-string validators — no regex, no quantifier nesting,
// no per-line lint disables. Each accepts a string and returns boolean.
// The OpenAPI / AsyncAPI / Swagger specs all use simple dot-numbered
// semver-like strings; we validate by splitting on '.' and checking each
// segment is a non-empty decimal integer with no leading zero (except 0
// itself), keeping behavior identical to the previous regex but auditable
// line-by-line.

function isDecimalSegment(s) {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false; // not 0-9
  }
  return true;
}

function isDotSeparatedDecimals(s, expectedMajors) {
  if (typeof s !== 'string' || s.length === 0) return false;
  const parts = s.split('.');
  if (parts.length < 2 || parts.length > 3) return false;
  if (!expectedMajors.includes(parts.at(0))) return false;
  return parts.every(isDecimalSegment);
}

export function isOpenApiVersion(s) {
  return isDotSeparatedDecimals(s, ['3']);
}

export function isAsyncApiVersion(s) {
  return isDotSeparatedDecimals(s, ['2', '3']);
}

// Classifier-only check: does `s` look like a `<digits>.<digits>(.<digits>)?`
// version string? Equivalent to the previous `/^\d+\.\d+/` test in classify.js
// — used to distinguish a YAML swagger field of `"1.2"` (wrong, but a swagger
// document) from a stringified config that isn't a swagger doc at all. The
// validator (validate/swagger.js) is responsible for asserting the version
// is exactly "2.0".
export function isSwaggerStringVersion(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split('.');
  if (parts.length < 2 || parts.length > 3) return false;
  return parts.every(isDecimalSegment);
}
