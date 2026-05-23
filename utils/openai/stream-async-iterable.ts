export async function* streamAsyncIterable<T = Uint8Array>(
    stream: ReadableStream<T>
): AsyncIterable<T> {
    const reader = stream.getReader()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) {
                return
            }
            if (value !== undefined) {
                yield value
            }
        }
    } finally {
        reader.releaseLock()
    }
}