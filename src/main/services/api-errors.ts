export interface ValidationError {
  valid: false;
  error: string;
}

export function mapValidationError(err: unknown): ValidationError {
  const status = (err as { status?: number }).status;
  if (status === 401) return { valid: false, error: 'Invalid API key. Check that you copied it correctly.' };
  if (status === 403) return { valid: false, error: 'API key does not have permission. Generate a new one.' };
  return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
}
