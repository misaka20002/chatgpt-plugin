export async function* streamAsyncIterable(stream) {
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                return;
            }
            if (value !== undefined) {
                yield value;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
