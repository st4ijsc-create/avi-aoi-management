import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

export type ValidationRule = {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => string | null;
};

export type ValidationRules<T> = {
  [K in keyof T]?: ValidationRule;
};

export type ValidationErrors<T> = {
  [K in keyof T]?: string;
};

export function useFormValidation<T extends Record<string, any>>(
  rules: ValidationRules<T>
) {
  const [errors, setErrors] = useState<ValidationErrors<T>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const { t } = useTranslation();

  const validateField = useCallback(
    (field: keyof T, value: any): string | null => {
      const rule = rules[field];
      if (!rule) return null;

      // Required check
      if (rule.required) {
        if (value === undefined || value === null || value === "") {
          return t("validation.fieldRequired");
        }
        if (typeof value === "string" && value.trim() === "") {
          return t("validation.fieldRequired");
        }
      }

      // Skip other validations if value is empty and not required
      if (value === undefined || value === null || value === "") {
        return null;
      }

      // String validations
      if (typeof value === "string") {
        if (rule.minLength && value.length < rule.minLength) {
          return t("validation.minLength", { count: rule.minLength });
        }
        if (rule.maxLength && value.length > rule.maxLength) {
          return t("validation.maxLength", { count: rule.maxLength });
        }
        if (rule.pattern && !rule.pattern.test(value)) {
          return t("validation.invalidFormat");
        }
      }

      // Number validations
      if (typeof value === "number" || !isNaN(Number(value))) {
        const numValue = Number(value);
        if (rule.min !== undefined && numValue < rule.min) {
          return t("validation.minValue", { min: rule.min });
        }
        if (rule.max !== undefined && numValue > rule.max) {
          return t("validation.maxValue", { max: rule.max });
        }
      }

      // Custom validation
      if (rule.custom) {
        return rule.custom(value);
      }

      return null;
    },
    [rules, t]
  );

  const validate = useCallback(
    (data: Partial<T>): boolean => {
      const newErrors: ValidationErrors<T> = {};
      let isValid = true;

      for (const field of Object.keys(rules) as Array<keyof T>) {
        const error = validateField(field, data[field]);
        if (error) {
          newErrors[field] = error;
          isValid = false;
        }
      }

      setErrors(newErrors);
      return isValid;
    },
    [rules, validateField]
  );

  const validateSingleField = useCallback(
    (field: keyof T, value: any) => {
      const error = validateField(field, value);
      setErrors((prev) => ({
        ...prev,
        [field]: error || undefined,
      }));
      return error === null;
    },
    [validateField]
  );

  const handleBlur = useCallback(
    (field: keyof T, value: any) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      validateSingleField(field, value);
    },
    [validateSingleField]
  );

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  const getFieldError = useCallback(
    (field: keyof T): string | undefined => {
      return touched[field] ? errors[field] : undefined;
    },
    [errors, touched]
  );

  const hasError = useCallback(
    (field: keyof T): boolean => {
      return touched[field] === true && errors[field] !== undefined;
    },
    [errors, touched]
  );

  return {
    errors,
    touched,
    validate,
    validateSingleField,
    handleBlur,
    clearErrors,
    getFieldError,
    hasError,
    setTouched,
  };
}

// Common validation patterns
export const ValidationPatterns = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^[0-9+\-\s()]+$/,
  code: /^[A-Za-z0-9_-]+$/,
  alphanumeric: /^[A-Za-z0-9]+$/,
  numeric: /^[0-9]+$/,
  decimal: /^[0-9]+(\.[0-9]+)?$/,
};

// Helper function for validation message text
export function getValidationMessageText(error?: string): string | null {
  return error || null;
}
