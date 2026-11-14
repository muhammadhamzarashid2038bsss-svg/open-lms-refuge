// Vitest runs in Node. The server-only package's default entry throws there.
// Next.js replaces that package with an empty module when it builds server code.
export {};
