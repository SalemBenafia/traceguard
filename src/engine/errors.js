// Log lines carry a short code, because error text can quote customer content.
const SAFE_LABEL = /^[\w.:-]{1,64}$/;

export function errorLabel(error) {
  const label = String(error?.code ?? error?.status ?? error?.name ?? 'UNKNOWN');
  return SAFE_LABEL.test(label) ? label : 'UNKNOWN';
}
