export type ConnectionRetryOptions = {
    maxRetries?: number
    delayMs?: number
    onRetry?: (context: {
        error: any
        retry: number
        maxRetries: number
        delayMs: number
        url: any
    }) => void
}

const CONNECTION_ERROR_CODES = new Set([
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'ETIMEDOUT',
    'ENETUNREACH',
    'EHOSTUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET'
])

const CONNECTION_ERROR_MESSAGES = [
    'client network socket disconnected',
    'socket hang up',
    'network socket disconnected',
    'tls connection'
]

function getErrorChain(error: any): any[] {
    const errors = []
    const seen = new Set()
    let current = error

    while (current && typeof current === 'object' && !seen.has(current)) {
        errors.push(current)
        seen.add(current)
        current = current.cause
    }

    return errors
}

export function isConnectionError(error: any): boolean {
    const errors = getErrorChain(error)
    if (errors.some(current => current.name === 'AbortError' || current.code === 'ABORT_ERR')) return false

    return errors.some(current => {
        const code = current.code || current.errno
        if (CONNECTION_ERROR_CODES.has(code)) return true

        const message = String(current.message || '').toLowerCase()
        return CONNECTION_ERROR_MESSAGES.some(fragment => message.includes(fragment))
    })
}

function wait(delayMs: number, signal?: AbortSignal | null): Promise<void> {
    if (!signal) return new Promise(resolve => setTimeout(resolve, delayMs))
    if (signal.aborted) return Promise.reject(signal.reason || new Error('The operation was aborted'))

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, delayMs)
        const onAbort = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            reject(signal.reason || new Error('The operation was aborted'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

export async function fetchWithConnectionRetry<T>(
    fetchFn: (url: any, options?: any) => Promise<T>,
    url: any,
    options: any = {},
    retryOptions: ConnectionRetryOptions = {}
): Promise<T> {
    const {
        maxRetries = 3,
        delayMs = 10_000,
        onRetry
    } = retryOptions

    let retry = 0
    while (true) {
        try {
            return await fetchFn(url, options)
        } catch (error) {
            if (options.signal?.aborted || !isConnectionError(error) || retry >= maxRetries) {
                throw error
            }

            retry++
            onRetry?.({ error, retry, maxRetries, delayMs, url })
            await wait(delayMs, options.signal)
        }
    }
}
