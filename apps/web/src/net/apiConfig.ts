export function getApiBaseUrl(): string {
  const url = import.meta.env.VITE_API_URL;
  if (!url) return '';
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '');
  }
  return `https://${trimmed}`.replace(/\/+$/, '');
}
