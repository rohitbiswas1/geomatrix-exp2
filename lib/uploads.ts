export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_ACCEPT = '.csv,.json';
export function validateUpload(file: File): string | null {
  if (!/\.(csv|json)$/i.test(file.name)) return 'Choose a CSV or JSON records file. Save Excel sheets as CSV first.';
  if (file.size === 0) return 'This file is empty. Include a header and at least one data row.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Files must be 4 MB or smaller. Split larger files before uploading.';
  return null;
}
