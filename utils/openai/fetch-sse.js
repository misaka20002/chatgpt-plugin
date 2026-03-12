import { createParser } from 'eventsource-parser';
import * as types from './types.js';
import nodefetch from 'node-fetch';
import { streamAsyncIterable } from './stream-async-iterable.js';
export async function fetchSSE(url, options, fetch = nodefetch) {
    const { onMessage, onError, ...fetchOptions } = options;
    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
        let reason;
        try {
            reason = await res.text();
        }
        catch (err) {
            reason = res.statusText;
        }
        const msg = `ChatGPT error ${res.status}: ${reason}`;
        const error = new types.ChatGPTError(msg);
        error.statusCode = res.status;
        error.statusText = res.statusText;
        throw error;
    }
    const parser = createParser((event) => {
        if (event.type === 'event') {
            onMessage(event.data);
        }
    });
    // handle special response errors
    const feed = (chunk) => {
        let response = null;
        try {
            response = JSON.parse(chunk);
        }
        catch {
            // ignore
        }
        if (response?.detail?.type === 'invalid_request_error') {
            const msg = `ChatGPT error ${response.detail.message}: ${response.detail.code} (${response.detail.type})`;
            const error = new types.ChatGPTError(msg);
            error.statusCode = response.detail.code;
            error.statusText = response.detail.message;
            if (onError) {
                onError(error);
            }
            else {
                console.error(error);
            }
            return;
        }
        parser.feed(chunk);
    };
    if (!res.body?.getReader) {
        const body = res.body;
        if (!body.on || !body.read) {
            throw new types.ChatGPTError('unsupported "fetch" implementation');
        }
        body.on('readable', () => {
            let chunk;
            while (null !== (chunk = body.read())) {
                feed(chunk.toString());
            }
        });
    }
    else {
        for await (const chunk of streamAsyncIterable(res.body)) {
            const str = new TextDecoder().decode(chunk);
            feed(str);
        }
    }
}
