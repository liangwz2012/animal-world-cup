const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const BASE_PATH = rawBasePath.replace(/\/+$/, "");

export function publicPath(path) {
  const value = String(path || "");
  if (!BASE_PATH || /^https?:\/\//.test(value)) return value;
  return `${BASE_PATH}${value.startsWith("/") ? value : `/${value}`}`;
}

export function routePath(path) {
  return publicPath(path);
}
