export function validateSelfUpdate(newCode) {
  if (!newCode || typeof newCode !== 'string') {
    throw new Error('No code provided for self-update');
  }
  return true;
}