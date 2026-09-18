export function getFieldError(errors: Record<string, string[] | string> | undefined, name: string) {
  const value = errors?.[name]
  return Array.isArray(value) ? value[0] : value
}
