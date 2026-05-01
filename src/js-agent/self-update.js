/**
 * Self-Update Validation
 *
 * Provides utility functions for validating new agent code before
 * it is evaluated during a self-update operation.
 */

/**
 * Validate that the provided code is suitable for self-update.
 *
 * @param {string} newCode - New agent source code to validate
 * @returns {boolean} True if the code is valid
 * @throws {Error} If no code is provided or the type is incorrect
 */
export function validateSelfUpdate(newCode) {
  if (!newCode || typeof newCode !== 'string') {
    throw new Error('No code provided for self-update');
  }
  return true;
}