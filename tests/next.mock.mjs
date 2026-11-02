export class NextResponse extends Response {}
export const jar = new Map();
export const cookieOptions = new Map();
export async function cookies() {
  return {
    get: (key) => jar.has(key) ? { name: key, value: jar.get(key) } : undefined,
    set: (key, value, options) => { jar.set(key, value); cookieOptions.set(key, options); },
    delete: (key) => { jar.delete(key); cookieOptions.delete(key); },
  };
}
