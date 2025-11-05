import type { ResponseValidator } from './types.ts'

/**
 * Creates a basic JSON structure validator
 */
export function createBasicJsonValidator(): ResponseValidator {
  return {
    validate: (parsed: unknown): boolean => {
      return parsed !== null && typeof parsed === 'object'
    }
  }
}

/**
 * Creates a custom validator with provided validation logic
 */
export function createCustomValidator(
  validatorFn: (parsed: unknown) => boolean
): ResponseValidator {
  return {
    validate: (parsed: unknown): boolean => {
      return validatorFn(parsed)
    }
  }
}

/**
 * Creates a validation pipeline that chains multiple validators
 */
export function createValidationPipeline(
  validators: ResponseValidator[]
): ResponseValidator {
  return {
    validate: (parsed: unknown): boolean => {
      return validators.every((validator) => validator.validate(parsed))
    }
  }
}

/**
 * Creates a no-op validator that always returns true
 */
export function createNoOpValidator(): ResponseValidator {
  return {
    validate: (_parsed: unknown): boolean => {
      return true
    }
  }
}
