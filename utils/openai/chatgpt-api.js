var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
import Keyv from 'keyv';
import pTimeout from 'p-timeout';
import QuickLRU from 'quick-lru';
import { v4 as uuidv4 } from 'uuid';
import * as tokenizer from './tokenizer.js';
import * as types from './types.js';
import globalFetch from 'node-fetch';
import { fetchSSE } from './fetch-sse.js';
var CHATGPT_MODEL = 'gpt-4o-mini';
var USER_LABEL_DEFAULT = 'User';
var ASSISTANT_LABEL_DEFAULT = 'ChatGPT';
var TOOL_LABEL_DEFAULT = 'Tool';
function extractTextContent(content) {
    if (!content) {
        return '';
    }
    return typeof content === 'string'
        ? content
        : content.filter(function (part) { return part.type === 'text'; }).map(function (part) { return part.text; }).join('\n');
}
function getStoredMessageRole(role) {
    if (role === 'tool' || role === 'assistant' || role === 'system') {
        return role;
    }
    if (role === 'function') {
        return 'function';
    }
    return 'user';
}
var ChatGPTAPI = /** @class */ (function () {
    /**
     * Creates a new client wrapper around OpenAI's chat completion API, mimicing the official ChatGPT webapp's functionality as closely as possible.
     *
     * @param apiKey - OpenAI API key (required).
     * @param apiOrg - Optional OpenAI API organization (optional).
     * @param apiBaseUrl - Optional override for the OpenAI API base URL.
     * @param debug - Optional enables logging debugging info to stdout.
     * @param completionParams - Param overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
     * @param maxModelTokens - Optional override for the maximum number of tokens allowed by the model's context. Defaults to 4096.
     * @param maxResponseTokens - Optional override for the minimum number of tokens allowed for the model's response. Defaults to 1000.
     * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
     * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
     */
    function ChatGPTAPI(opts) {
        var apiKey = opts.apiKey, apiOrg = opts.apiOrg, _a = opts.apiBaseUrl, apiBaseUrl = _a === void 0 ? 'https://api.openai.com/v1' : _a, _b = opts.debug, debug = _b === void 0 ? false : _b, messageStore = opts.messageStore, completionParams = opts.completionParams, systemMessage = opts.systemMessage, _c = opts.maxModelTokens, maxModelTokens = _c === void 0 ? 4096 : _c, _d = opts.maxResponseTokens, maxResponseTokens = _d === void 0 ? 8192 : _d, getMessageById = opts.getMessageById, upsertMessage = opts.upsertMessage, _e = opts.fetch, fetch = _e === void 0 ? globalFetch : _e;
        this._apiKey = apiKey;
        this._apiOrg = apiOrg;
        this._apiBaseUrl = apiBaseUrl;
        this._debug = !!debug;
        this._fetch = fetch;
        this._completionParams = __assign({ model: CHATGPT_MODEL, temperature: 0.8, top_p: 1.0, presence_penalty: 1.0 }, completionParams);
        this._systemMessage = systemMessage;
        if (this._systemMessage === undefined) {
            var currentDate = new Date().toISOString().split('T')[0];
            this._systemMessage = "You are ChatGPT, a large language model trained by OpenAI. Answer as concisely as possible.\nKnowledge cutoff: 2021-09-01\nCurrent date: ".concat(currentDate);
        }
        this._maxModelTokens = maxModelTokens;
        this._maxResponseTokens = maxResponseTokens;
        this._getMessageById = getMessageById !== null && getMessageById !== void 0 ? getMessageById : this._defaultGetMessageById;
        this._upsertMessage = upsertMessage !== null && upsertMessage !== void 0 ? upsertMessage : this._defaultUpsertMessage;
        if (messageStore) {
            this._messageStore = messageStore;
        }
        else {
            this._messageStore = new Keyv({
                store: new QuickLRU({ maxSize: 10000 })
            });
        }
        if (!this._apiKey) {
            throw new Error('OpenAI missing required apiKey');
        }
        if (!this._fetch) {
            throw new Error('Invalid environment; fetch is not defined');
        }
        if (typeof this._fetch !== 'function') {
            throw new Error('Invalid "fetch" is not a function');
        }
    }
    ChatGPTAPI.prototype._toRequestMessage = function (message) {
        var storedRole = getStoredMessageRole(message.role);
        var content = message.originalContent || message.text;
        var hasToolCalls = !!(message.toolCalls && message.toolCalls.length);
        if (storedRole === 'function') {
            return null;
        }
        if (storedRole === 'tool') {
            if (!message.toolCallId) {
                return null;
            }
            return {
                role: 'tool',
                content: content || '',
                tool_call_id: message.toolCallId
            };
        }
        return {
            role: storedRole,
            content: content || '',
            name: storedRole === 'user' ? message.name : undefined,
            function_call: storedRole === 'assistant' && !hasToolCalls ? message.functionCall : undefined,
            tool_calls: storedRole === 'assistant' ? message.toolCalls : undefined
        };
    };
    ChatGPTAPI.prototype._getMessageTokenEstimate = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var contentString, nonTextTokens, _i, _a, part, promptLine, tokenCount;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        contentString = extractTextContent(message.content);
                        nonTextTokens = 0;
                        if (Array.isArray(message.content)) {
                            for (_i = 0, _a = message.content; _i < _a.length; _i++) {
                                part = _a[_i];
                                if (part.type === 'image_url')
                                    nonTextTokens += 85;
                                if (part.type === 'input_audio')
                                    nonTextTokens += 100;
                            }
                        }
                        promptLine = '';
                        switch (message.role) {
                            case 'system':
                                promptLine = "Instructions:\n".concat(contentString);
                                break;
                            case 'user':
                                promptLine = "".concat(USER_LABEL_DEFAULT, ":\n").concat(contentString);
                                break;
                            case 'assistant':
                                promptLine = "".concat(ASSISTANT_LABEL_DEFAULT, ":\n").concat(contentString);
                                break;
                            case 'tool':
                                promptLine = "".concat(TOOL_LABEL_DEFAULT, ":\n").concat(contentString);
                                break;
                        }
                        return [4 /*yield*/, this._getTokenCount(promptLine)];
                    case 1:
                        tokenCount = (_b.sent()) + nonTextTokens;
                        if (!message.function_call) return [3 /*break*/, 3];
                        return [4 /*yield*/, this._getTokenCount(JSON.stringify(message.function_call))];
                    case 2:
                        tokenCount += _b.sent();
                        _b.label = 3;
                    case 3:
                        if (!message.tool_calls) return [3 /*break*/, 5];
                        return [4 /*yield*/, this._getTokenCount(JSON.stringify(message.tool_calls))];
                    case 4:
                        tokenCount += _b.sent();
                        _b.label = 5;
                    case 5:
                        if (!message.tool_call_id) return [3 /*break*/, 7];
                        return [4 /*yield*/, this._getTokenCount(message.tool_call_id)];
                    case 6:
                        tokenCount += _b.sent();
                        _b.label = 7;
                    case 7: return [2 /*return*/, tokenCount];
                }
            });
        });
    };
    /**
     * Sends a message to the OpenAI chat completions endpoint, waits for the response
     * to resolve, and returns the response.
     *
     * If you want your response to have historical context, you must provide a valid `parentMessageId`.
     *
     * If you want to receive a stream of partial responses, use `opts.onProgress`.
     *
     * Set `debug: true` in the `ChatGPTAPI` constructor to log more info on the full prompt sent to the OpenAI chat completions API. You can override the `systemMessage` in `opts` to customize the assistant's instructions.
     *
     * @param content - The prompt message to send: 多模态消息体封装：将传给 sendMessage 的参数从单纯的 string 放开为 string | ChatCompletionContentPart[]。你现在可以在上层应用构建好 [{ type: 'text', text: '描述一下这个图' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,....' } }]
     * @param opts.parentMessageId - Optional ID of the previous message in the conversation (defaults to `undefined`)
     * @param opts.conversationId - Optional ID of the conversation (defaults to `undefined`)
     * @param opts.messageId - Optional ID of the message to send (defaults to a random UUID)
     * @param opts.systemMessage - Optional override for the chat "system message" which acts as instructions to the model (defaults to the ChatGPT system message)
     * @param opts.timeoutMs - Optional timeout in milliseconds (defaults to no timeout)
     * @param opts.onProgress - Optional callback which will be invoked every time the partial response is updated
     * @param opts.abortSignal - Optional callback used to abort the underlying `fetch` call using an [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
     * @param completionParams - Optional overrides to send to the [OpenAI chat completion API](https://platform.openai.com/docs/api-reference/chat/create). Options like `temperature` and `presence_penalty` can be tweaked to change the personality of the assistant.
     *
     * @returns The response from ChatGPT
     */
    ChatGPTAPI.prototype.sendMessage = function (content_1) {
        return __awaiter(this, arguments, void 0, function (content, opts, role) {
            var parentMessageId, _a, messageId, timeoutMs, onProgress, _b, stream, completionParams, conversationId, abortSignal, abortController, currentMessages, message, _c, messages, maxTokens, numTokens, result, responseP;
            var _this = this;
            if (opts === void 0) { opts = {}; }
            if (role === void 0) { role = 'user'; }
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        parentMessageId = opts.parentMessageId, _a = opts.messageId, messageId = _a === void 0 ? uuidv4() : _a, timeoutMs = opts.timeoutMs, onProgress = opts.onProgress, _b = opts.stream, stream = _b === void 0 ? onProgress ? true : false : _b, completionParams = opts.completionParams, conversationId = opts.conversationId;
                        abortSignal = opts.abortSignal;
                        abortController = null;
                        if (timeoutMs && !abortSignal) {
                            abortController = new AbortController();
                            abortSignal = abortController.signal;
                        }
                        currentMessages = __spreadArray([], (opts.appendMessages || []), true);
                        if (content !== null) {
                            if (role === 'tool' && !opts.toolCallId) {
                                throw new Error('tool role message requires toolCallId');
                            }
                            message = {
                                role: role,
                                id: messageId,
                                conversationId: conversationId,
                                parentMessageId: currentMessages.length > 0 ? currentMessages[currentMessages.length - 1].id : parentMessageId,
                                text: extractTextContent(content),
                                originalContent: content,
                                name: role === 'user' ? opts.name : undefined,
                                toolCallId: role === 'tool' ? opts.toolCallId : undefined
                            };
                            currentMessages.push(message);
                        }
                        if (currentMessages.length === 0) {
                            throw new Error('sendMessage requires content or appendMessages');
                        }
                        return [4 /*yield*/, this._buildMessages(currentMessages, opts, completionParams)];
                    case 1:
                        _c = _d.sent(), messages = _c.messages, maxTokens = _c.maxTokens, numTokens = _c.numTokens;
                        console.log("maxTokens: ".concat(maxTokens, ", numTokens: ").concat(numTokens));
                        result = {
                            role: 'assistant',
                            id: uuidv4(),
                            conversationId: conversationId,
                            parentMessageId: currentMessages[currentMessages.length - 1].id,
                            text: '',
                            thinking_text: '',
                            functionCall: undefined,
                            toolCalls: undefined,
                            conversation: []
                        };
                        responseP = new Promise(function (resolve, reject) { return __awaiter(_this, void 0, void 0, function () {
                            var url, headers, body, res, reason, msg, error, response, message_1, res_1, err_1;
                            var _a, _b;
                            return __generator(this, function (_c) {
                                switch (_c.label) {
                                    case 0:
                                        url = "".concat(this._apiBaseUrl, "/chat/completions");
                                        headers = {
                                            'Content-Type': 'application/json',
                                            Authorization: "Bearer ".concat(this._apiKey)
                                        };
                                        body = __assign(__assign(__assign({ max_tokens: maxTokens }, this._completionParams), completionParams), { messages: messages, stream: stream });
                                        // 如果存在 functions，将其转换为 tools 格式
                                        if (body.functions && body.functions.length > 0) {
                                            body.tools = body.functions.map(function (func) { return ({
                                                type: "function",
                                                function: func
                                            }); });
                                            delete body.functions;
                                        }
                                        if (this._debug) {
                                            console.log(JSON.stringify(body));
                                        }
                                        // Support multiple organizations
                                        // See https://platform.openai.com/docs/api-reference/authentication
                                        if (this._apiOrg) {
                                            headers['OpenAI-Organization'] = this._apiOrg;
                                        }
                                        if (this._debug) {
                                            console.log("sendMessage (".concat(numTokens, " tokens)"), body);
                                        }
                                        if (!stream) return [3 /*break*/, 1];
                                        fetchSSE(url, {
                                            method: 'POST',
                                            headers: headers,
                                            body: JSON.stringify(body),
                                            signal: abortSignal,
                                            onMessage: function (data) {
                                                var _a;
                                                if (data === '[DONE]') {
                                                    result.text = result.text.trim();
                                                    if (result.functionCall && (!result.toolCalls || result.toolCalls.length === 0)) {
                                                        result.toolCalls = [{
                                                                id: "call_".concat(uuidv4()),
                                                                type: 'function',
                                                                function: result.functionCall
                                                            }];
                                                    }
                                                    result.conversation = messages;
                                                    return resolve(result);
                                                }
                                                try {
                                                    var response = JSON.parse(data);
                                                    if (response.id) {
                                                        result.id = response.id;
                                                    }
                                                    if ((_a = response.choices) === null || _a === void 0 ? void 0 : _a.length) {
                                                        var delta = response.choices[0].delta;
                                                        if (delta.function_call && delta.function_call !== null) {
                                                            if (delta.function_call.name) {
                                                                result.functionCall = {
                                                                    name: delta.function_call.name,
                                                                    arguments: delta.function_call.arguments
                                                                };
                                                            }
                                                            else {
                                                                result.functionCall.arguments = (result.functionCall.arguments || '') + delta.function_call.arguments;
                                                            }
                                                        }
                                                        else if (delta.tool_calls && delta.tool_calls.length > 0) {
                                                            if (!result.toolCalls) {
                                                                result.toolCalls = [];
                                                            }
                                                            for (var _i = 0, _b = delta.tool_calls; _i < _b.length; _i++) {
                                                                var incomingToolCall = _b[_i];
                                                                var toolCallIndex = incomingToolCall.index || 0;
                                                                if (!result.toolCalls[toolCallIndex]) {
                                                                    result.toolCalls[toolCallIndex] = {
                                                                        id: incomingToolCall.id || "call_".concat(uuidv4()),
                                                                        type: 'function',
                                                                        function: {
                                                                            name: (incomingToolCall.function && incomingToolCall.function.name) || '',
                                                                            arguments: (incomingToolCall.function && incomingToolCall.function.arguments) || ''
                                                                        }
                                                                    };
                                                                }
                                                                else {
                                                                    if (incomingToolCall.id) {
                                                                        result.toolCalls[toolCallIndex].id = incomingToolCall.id;
                                                                    }
                                                                    if (incomingToolCall.function && incomingToolCall.function.name) {
                                                                        result.toolCalls[toolCallIndex].function.name = incomingToolCall.function.name;
                                                                    }
                                                                    if (incomingToolCall.function && incomingToolCall.function.arguments) {
                                                                        result.toolCalls[toolCallIndex].function.arguments =
                                                                            (result.toolCalls[toolCallIndex].function.arguments || '') + incomingToolCall.function.arguments;
                                                                    }
                                                                }
                                                            }
                                                            if (result.toolCalls.length > 0) {
                                                                result.functionCall = result.toolCalls[0].function;
                                                            }
                                                        }
                                                        else {
                                                            result.delta = delta.content;
                                                            if (delta === null || delta === void 0 ? void 0 : delta.content)
                                                                result.text += delta.content;
                                                            if (delta === null || delta === void 0 ? void 0 : delta.reasoning_content)
                                                                result.thinking_text += delta.reasoning_content;
                                                        }
                                                        if (delta.role) {
                                                            result.role = delta.role;
                                                        }
                                                        result.detail = response;
                                                        onProgress === null || onProgress === void 0 ? void 0 : onProgress(result);
                                                    }
                                                }
                                                catch (err) {
                                                    console.warn('OpenAI stream SEE event unexpected error', err);
                                                    return reject(err);
                                                }
                                            }
                                        }, this._fetch).catch(reject);
                                        return [3 /*break*/, 7];
                                    case 1:
                                        _c.trys.push([1, 6, , 7]);
                                        return [4 /*yield*/, this._fetch(url, {
                                                method: 'POST',
                                                headers: headers,
                                                body: JSON.stringify(body),
                                                signal: abortSignal
                                            })];
                                    case 2:
                                        res = _c.sent();
                                        if (!!res.ok) return [3 /*break*/, 4];
                                        return [4 /*yield*/, res.text()];
                                    case 3:
                                        reason = _c.sent();
                                        msg = "OpenAI error ".concat(res.status || res.statusText, ": ").concat(reason);
                                        error = new types.ChatGPTError(msg);
                                        error.statusCode = res.status;
                                        error.statusText = res.statusText;
                                        return [2 /*return*/, reject(error)];
                                    case 4: return [4 /*yield*/, res.json()];
                                    case 5:
                                        response = (_c.sent());
                                        if (this._debug) {
                                            console.log(response);
                                        }
                                        if (response === null || response === void 0 ? void 0 : response.id) {
                                            result.id = response.id;
                                        }
                                        if ((_a = response === null || response === void 0 ? void 0 : response.choices) === null || _a === void 0 ? void 0 : _a.length) {
                                            message_1 = response.choices[0].message;
                                            if (message_1.content) {
                                                result.text = typeof message_1.content === 'string' ? message_1.content : message_1.content.filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('\n');
                                                result.originalContent = message_1.content;
                                            }
                                            else if (message_1.function_call && message_1.function_call !== null) {
                                                result.functionCall = message_1.function_call;
                                                result.toolCalls = [{
                                                        id: "call_".concat(uuidv4()),
                                                        type: 'function',
                                                        function: message_1.function_call
                                                    }];
                                            }
                                            else if (message_1.tool_calls && message_1.tool_calls.length > 0) {
                                                // 设置 functionCall 以兼容旧代码
                                                result.functionCall = message_1.tool_calls.map(function (tool) { return tool.function; })[0];
                                                // 同时设置 toolCalls 以支持新的格式
                                                result.toolCalls = message_1.tool_calls;
                                            }
                                            result.thinking_text = message_1.reasoning_content;
                                            if (message_1.role) {
                                                result.role = message_1.role;
                                            }
                                        }
                                        else {
                                            res_1 = response;
                                            console.error(res_1);
                                            return [2 /*return*/, reject(new Error("OpenAI error: ".concat(((_b = res_1 === null || res_1 === void 0 ? void 0 : res_1.detail) === null || _b === void 0 ? void 0 : _b.message) || (res_1 === null || res_1 === void 0 ? void 0 : res_1.detail) || 'unknown')))];
                                        }
                                        result.detail = response;
                                        result.conversation = messages;
                                        return [2 /*return*/, resolve(result)];
                                    case 6:
                                        err_1 = _c.sent();
                                        return [2 /*return*/, reject(err_1)];
                                    case 7: return [2 /*return*/];
                                }
                            });
                        }); }).then(function (message) { return __awaiter(_this, void 0, void 0, function () {
                            var promptTokens, completionTokens, err_2;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        if (!(message.detail && !message.detail.usage)) return [3 /*break*/, 4];
                                        _a.label = 1;
                                    case 1:
                                        _a.trys.push([1, 3, , 4]);
                                        promptTokens = numTokens;
                                        return [4 /*yield*/, this._getTokenCount(message.text)];
                                    case 2:
                                        completionTokens = _a.sent();
                                        message.detail.usage = {
                                            prompt_tokens: promptTokens,
                                            completion_tokens: completionTokens,
                                            total_tokens: promptTokens + completionTokens,
                                            estimated: true
                                        };
                                        return [3 /*break*/, 4];
                                    case 3:
                                        err_2 = _a.sent();
                                        return [3 /*break*/, 4];
                                    case 4: return [2 /*return*/, Promise.all(__spreadArray(__spreadArray([], currentMessages.map(function (currentMessage) { return _this._upsertMessage(currentMessage); }), true), [
                                            this._upsertMessage(message)
                                        ], false)).then(function () { return message; })];
                                }
                            });
                        }); });
                        if (timeoutMs) {
                            if (abortController) {
                                // This will be called when a timeout occurs in order for us to forcibly
                                // ensure that the underlying HTTP request is aborted.
                                ;
                                responseP.cancel = function () {
                                    abortController.abort();
                                };
                            }
                            return [2 /*return*/, pTimeout(responseP, {
                                    milliseconds: timeoutMs,
                                    message: 'OpenAI timed out waiting for response'
                                })];
                        }
                        else {
                            return [2 /*return*/, responseP];
                        }
                        return [2 /*return*/];
                }
            });
        });
    };
    Object.defineProperty(ChatGPTAPI.prototype, "apiKey", {
        // @ts-ignore
        get: function () {
            return this._apiKey;
        },
        // @ts-ignore
        set: function (apiKey) {
            this._apiKey = apiKey;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ChatGPTAPI.prototype, "apiOrg", {
        // @ts-ignore
        get: function () {
            return this._apiOrg;
        },
        // @ts-ignore
        set: function (apiOrg) {
            this._apiOrg = apiOrg;
        },
        enumerable: false,
        configurable: true
    });
    ChatGPTAPI.prototype._buildMessages = async function (currentMessages, opts, completionParams) {
        var _a, _b;
        var systemMessage = (_a = opts.systemMessage) !== null && _a !== void 0 ? _a : this._systemMessage;
        var parentMessageId = (_b = currentMessages[0]) === null || _b === void 0 ? void 0 : _b.parentMessageId;
        var promptBudget = this._maxResponseTokens < this._maxModelTokens
            ? this._maxModelTokens - this._maxResponseTokens
            : this._maxModelTokens - 1;
        var messages = [];
        if (systemMessage) {
            messages.push({
                role: 'system',
                content: systemMessage
            });
        }
        var systemMessageOffset = messages.length;
        var currentRequestMessages = currentMessages
            .map(function (message) { return this._toRequestMessage(message); }, this)
            .filter(Boolean);
        var nextMessages = messages.concat(currentRequestMessages);
        var functionToken = 0;
        var numTokens = functionToken;
        while (true) {
            var nextNumTokensEstimate = functionToken;
            for (var _i = 0, nextMessages_1 = nextMessages; _i < nextMessages_1.length; _i++) {
                var message = nextMessages_1[_i];
                nextNumTokensEstimate += await this._getMessageTokenEstimate(message);
            }
            var isValidPrompt = nextNumTokensEstimate <= promptBudget;
            var includesOnlyCurrentTurn = nextMessages.length === systemMessageOffset + currentRequestMessages.length;
            if (includesOnlyCurrentTurn || isValidPrompt) {
                messages = nextMessages;
                numTokens = nextNumTokensEstimate;
            }
            if (!isValidPrompt || !parentMessageId) {
                break;
            }
            var parentMessage = await this._getMessageById(parentMessageId);
            if (!parentMessage) {
                break;
            }
            var storedRole = getStoredMessageRole(parentMessage.role);
            if (storedRole === 'tool') {
                var toolHistoryMessages = [];
                var cursor = parentMessage;
                while (cursor && getStoredMessageRole(cursor.role) === 'tool') {
                    toolHistoryMessages.unshift(cursor);
                    cursor = cursor.parentMessageId ? await this._getMessageById(cursor.parentMessageId) : undefined;
                }
                parentMessageId = cursor === null || cursor === void 0 ? void 0 : cursor.parentMessageId;
                var assistantRequestMessage = cursor ? this._toRequestMessage(cursor) : null;
                var toolRequestMessages = toolHistoryMessages
                    .map(function (message) { return this._toRequestMessage(message); }, this)
                    .filter(Boolean);
                if ((assistantRequestMessage === null || assistantRequestMessage === void 0 ? void 0 : assistantRequestMessage.role) !== 'assistant' ||
                    !((assistantRequestMessage === null || assistantRequestMessage === void 0 ? void 0 : assistantRequestMessage.tool_calls) && assistantRequestMessage.tool_calls.length) ||
                    toolRequestMessages.length !== toolHistoryMessages.length) {
                    continue;
                }
                nextMessages = nextMessages.slice(0, systemMessageOffset).concat(__spreadArray(__spreadArray([
                    assistantRequestMessage
                ], toolRequestMessages, true), nextMessages.slice(systemMessageOffset), true));
                continue;
            }
            var parentRequestMessage = this._toRequestMessage(parentMessage);
            parentMessageId = parentMessage.parentMessageId;
            if (!parentRequestMessage) {
                continue;
            }
            nextMessages = nextMessages.slice(0, systemMessageOffset).concat(__spreadArray([
                parentRequestMessage
            ], nextMessages.slice(systemMessageOffset), true));
        }
        var maxTokens = Math.max(1, this._maxResponseTokens);
        return { messages: messages, maxTokens: maxTokens, numTokens: numTokens };
    };
    ChatGPTAPI.prototype._getTokenCount = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!text) {
                    return [2 /*return*/, 0];
                }
                // TODO: use a better fix in the tokenizer
                text = text.replace(/<\|endoftext\|>/g, '');
                return [2 /*return*/, tokenizer.encode(text).length];
            });
        });
    };
    ChatGPTAPI.prototype._defaultGetMessageById = function (id) {
        return __awaiter(this, void 0, void 0, function () {
            var res;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._messageStore.get(id)];
                    case 1:
                        res = _a.sent();
                        return [2 /*return*/, res];
                }
            });
        });
    };
    ChatGPTAPI.prototype._defaultUpsertMessage = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0: return [4 /*yield*/, this._messageStore.set(message.id, message)];
                    case 1:
                        _a.sent();
                        return [2 /*return*/];
                }
            });
        });
    };
    return ChatGPTAPI;
}());
export { ChatGPTAPI };
