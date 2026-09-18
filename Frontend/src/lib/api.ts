import axios, { AxiosError } from 'axios'

export type FieldErrors = Record<string, string[] | string>

export class ApiError extends Error {
  fieldErrors?: FieldErrors
  status?: number
  retryAfter?: number

  constructor(message: string, options: { fieldErrors?: FieldErrors; status?: number; retryAfter?: number } = {}) {
    super(message)
    this.name = 'ApiError'
    this.fieldErrors = options.fieldErrors
    this.status = options.status
    this.retryAfter = options.retryAfter
  }
}

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string | { fieldErrors?: FieldErrors } }>) => {
    // No error.response at all means the request never got a reply from the
    // server — backend down, DNS failure, timeout, CORS rejection, etc. That
    // is a materially different situation from the server responding with
    // an error, and was previously indistinguishable: both fell through to
    // the same generic "Something went wrong" text, leaving a user with no
    // way to tell "the app is broken" apart from "the network/server is
    // unreachable" (the latter being something a retry might fix on its own).
    if (!error.response) {
      return Promise.reject(new ApiError('Connection failed. Check your internet connection and try again.', {
        status: undefined,
      }))
    }

    const payload = error.response.data?.error
    const fieldErrors = typeof payload === 'object' ? payload.fieldErrors : undefined
    const message = typeof payload === 'string' ? payload : 'Something went wrong. Please try again.'
    const retryAfterHeader = error.response.headers?.['retry-after']
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : undefined

    return Promise.reject(new ApiError(message, {
      fieldErrors,
      status: error.response.status,
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
    }))
  },
)

export default api