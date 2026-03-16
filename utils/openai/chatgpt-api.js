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
     * @param chatgptBlockCount
     * @param messageStore - Optional [Keyv](https://github.com/jaredwray/keyv) store to persist chat messages to. If not provided, messages will be lost when the process exits.
     * @param getMessageById - Optional function to retrieve a message by its ID. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param upsertMessage - Optional function to insert or update a message. If not provided, the default implementation will be used (using an in-memory `messageStore`).
     * @param fetch - Optional override for the `fetch` implementation to use. Defaults to the global `fetch` function.
     */
    function ChatGPTAPI(opts) {
        var apiKey = opts.apiKey, apiOrg = opts.apiOrg, _a = opts.apiBaseUrl, apiBaseUrl = _a === void 0 ? 'https://api.openai.com/v1' : _a, _b = opts.debug, debug = _b === void 0 ? false : _b, messageStore = opts.messageStore, completionParams = opts.completionParams, systemMessage = opts.systemMessage, _c = opts.maxModelTokens, maxModelTokens = _c === void 0 ? 16000 : _c, _d = opts.maxResponseTokens, maxResponseTokens = _d === void 0 ? 8192 : _d, _e = opts.chatgptBlockCount, chatgptBlockCount = _e === void 0 ? 0 : _e, getMessageById = opts.getMessageById, upsertMessage = opts.upsertMessage, _f = opts.fetch, fetch = _f === void 0 ? globalFetch : _f;
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
        this._chatgptBlockCount = chatgptBlockCount;
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
        var _a, _b;
        var storedRole = getStoredMessageRole(message.role);
        var content = (_a = message.originalContent) !== null && _a !== void 0 ? _a : message.text;
        var hasToolCalls = !!((_b = message.toolCalls) === null || _b === void 0 ? void 0 : _b.length);
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
        var assistantContent = storedRole === 'assistant' && (hasToolCalls || message.functionCall)
            ? (content || null)
            : (content || '');
        return {
            role: storedRole,
            content: assistantContent,
            name: storedRole === 'user' ? message.name : undefined,
            function_call: storedRole === 'assistant' && !hasToolCalls ? message.functionCall : undefined,
            tool_calls: storedRole === 'assistant' ? message.toolCalls : undefined
        };
    };
    ChatGPTAPI.prototype._getMessageTokenEstimate = function (message) {
        return __awaiter(this, void 0, void 0, function () {
            var contentString, nonTextTokens, _i, _a, part, promptLine, tokenCount, _b, _c, _d;
            return __generator(this, function (_e) {
                switch (_e.label) {
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
                        tokenCount = (_e.sent()) + nonTextTokens;
                        if (!message.function_call) return [3 /*break*/, 3];
                        _b = tokenCount;
                        return [4 /*yield*/, this._getTokenCount(JSON.stringify(message.function_call))];
                    case 2:
                        tokenCount = _b + _e.sent();
                        _e.label = 3;
                    case 3:
                        if (!message.tool_calls) return [3 /*break*/, 5];
                        _c = tokenCount;
                        return [4 /*yield*/, this._getTokenCount(JSON.stringify(message.tool_calls))];
                    case 4:
                        tokenCount = _c + _e.sent();
                        _e.label = 5;
                    case 5:
                        if (!message.tool_call_id) return [3 /*break*/, 7];
                        _d = tokenCount;
                        return [4 /*yield*/, this._getTokenCount(message.tool_call_id)];
                    case 6:
                        tokenCount = _d + _e.sent();
                        _e.label = 7;
                    case 7: return [2 /*return*/, tokenCount];
                }
            });
        });
    };
    ChatGPTAPI.prototype._stripImages = function (content) {
        if (!content || typeof content === 'string')
            return content;
        if (Array.isArray(content)) {
            return content.map(function (part) {
                if (part.type === 'image_url') {
                    return { type: 'text', text: '[图片]' };
                }
                if (part.type === 'input_audio') {
                    return { type: 'text', text: '[音频]' };
                }
                if (part.type === 'input_video') {
                    return { type: 'text', text: '[视频]' };
                }
                return part;
            });
        }
        return content;
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
            var parentMessageId, _a, messageId, timeoutMs, onProgress, _b, stream, _c, completionParams, conversationId, abortSignal, abortController, currentMessages, message, _d, messages, maxTokens, numTokens, trimInfo, result, responseP;
            var _this = this;
            if (opts === void 0) { opts = {}; }
            if (role === void 0) { role = 'user'; }
            return __generator(this, function (_e) {
                switch (_e.label) {
                    case 0:
                        parentMessageId = opts.parentMessageId, _a = opts.messageId, messageId = _a === void 0 ? uuidv4() : _a, timeoutMs = opts.timeoutMs, onProgress = opts.onProgress, _b = opts.stream, stream = _b === void 0 ? onProgress ? true : false : _b, _c = opts.completionParams, completionParams = _c === void 0 ? {} : _c, conversationId = opts.conversationId;
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
                        _d = _e.sent(), messages = _d.messages, maxTokens = _d.maxTokens, numTokens = _d.numTokens, trimInfo = _d.trimInfo;
                        console.log("[ChatGPT][API] \u8F93\u5165Token(".concat(numTokens, ") | \u56DE\u590D\u4E0A\u9650(").concat(maxTokens, ") | \u603B\u4E0A\u4E0B\u6587(").concat(this._maxModelTokens, ")"));
                        if (numTokens + maxTokens > this._maxModelTokens) {
                            console.warn("[ChatGPT][API] \u5F53\u524D token \u914D\u7F6E\u8FB9\u754C\u8FC7\u7D27\uFF1A\u8F93\u5165Token(".concat(numTokens, ") + \u56DE\u590D\u4E0A\u9650(").concat(maxTokens, ") > \u603B\u4E0A\u4E0B\u6587(").concat(this._maxModelTokens, ")\u3002\u8BF7\u68C0\u67E5\u9505\u5DF4\u4E2D\u7684\u201C\u56DE\u590D\u5185\u5BB9\u6700\u5927Token\u6570(apiMaxToken)\u201D\u4E0E\u201C\u6A21\u578B\u603B\u4E0A\u4E0B\u6587Token\u6570(maxModelTokens)\u201D\u914D\u7F6E\u662F\u5426\u8FC7\u7D27\uFF1B\u63D2\u4EF6\u5C06\u4F9D\u8D56\u5386\u53F2\u88C1\u526A\uFF0C\u82E5\u4ECD\u8D85\u9650\uFF0C\u53EF\u80FD\u89E6\u53D1\u7FA4\u804A\u4E0A\u4E0B\u6587\u538B\u7F29\u6216\u91CD\u8BD5\u3002"));
                        }
                        if (trimInfo.trimmed) {
                            console.log("[chatgpt] history trimmed: current=".concat(trimInfo.currentTurnMessages, ", keptHistory=").concat(trimInfo.keptHistoryMessages, ", attemptedHistory=").concat(trimInfo.attemptedHistoryMessages, ", droppedHistory=").concat(trimInfo.droppedHistoryMessages, ", keptToolChains=").concat(trimInfo.keptToolChainCount, ", budget=").concat(trimInfo.promptBudget, ", finalTokens=").concat(numTokens, ", reason=").concat(trimInfo.stopReason, "\u3002\u82E5\u8FD9\u7C7B\u65E5\u5FD7\u9891\u7E41\u51FA\u73B0\uFF0C\u8BF7\u68C0\u67E5\u9505\u5DF4\u4E2D\u7684\u201C\u56DE\u590D\u5185\u5BB9\u6700\u5927Token\u6570(apiMaxToken)\u201D\u4E0E\u201C\u6A21\u578B\u603B\u4E0A\u4E0B\u6587Token\u6570(maxModelTokens)\u201D\u914D\u7F6E\u662F\u5426\u8FC7\u7D27\u3002"));
                        }
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
                            var url, headers, body, modelStr, res, reason, msg, error, response, message, res_1, err_1;
                            var _a, _b, _c;
                            return __generator(this, function (_d) {
                                switch (_d.label) {
                                    case 0:
                                        url = "".concat(this._apiBaseUrl, "/chat/completions");
                                        headers = {
                                            'Content-Type': 'application/json',
                                            Authorization: "Bearer ".concat(this._apiKey)
                                        };
                                        body = __assign(__assign(__assign({}, this._completionParams), completionParams), { messages: messages, stream: stream });
                                        modelStr = body.model || CHATGPT_MODEL;
                                        if (modelStr.startsWith('o1') || modelStr.startsWith('o3')) {
                                            body.max_completion_tokens = maxTokens;
                                        }
                                        else {
                                            body.max_tokens = maxTokens;
                                        }
                                        if (((_a = body.functions) === null || _a === void 0 ? void 0 : _a.length) > 0) {
                                            body.tools = body.functions.map(function (func) { return ({
                                                type: 'function',
                                                function: func
                                            }); });
                                            delete body.functions;
                                        }
                                        if (this._debug) {
                                            console.log(JSON.stringify(body));
                                        }
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
                                                var _a, _b, _c, _d, _e;
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
                                                            for (var _i = 0, _f = delta.tool_calls; _i < _f.length; _i++) {
                                                                var incomingToolCall = _f[_i];
                                                                var toolCallIndex = incomingToolCall.index || 0;
                                                                if (!result.toolCalls[toolCallIndex]) {
                                                                    result.toolCalls[toolCallIndex] = {
                                                                        id: incomingToolCall.id || "call_".concat(uuidv4()),
                                                                        type: 'function',
                                                                        function: {
                                                                            name: ((_b = incomingToolCall.function) === null || _b === void 0 ? void 0 : _b.name) || '',
                                                                            arguments: ((_c = incomingToolCall.function) === null || _c === void 0 ? void 0 : _c.arguments) || ''
                                                                        }
                                                                    };
                                                                }
                                                                else {
                                                                    if (incomingToolCall.id) {
                                                                        result.toolCalls[toolCallIndex].id = incomingToolCall.id;
                                                                    }
                                                                    if ((_d = incomingToolCall.function) === null || _d === void 0 ? void 0 : _d.name) {
                                                                        result.toolCalls[toolCallIndex].function.name = incomingToolCall.function.name;
                                                                    }
                                                                    if ((_e = incomingToolCall.function) === null || _e === void 0 ? void 0 : _e.arguments) {
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
                                        _d.trys.push([1, 6, , 7]);
                                        return [4 /*yield*/, this._fetch(url, {
                                                method: 'POST',
                                                headers: headers,
                                                body: JSON.stringify(body),
                                                signal: abortSignal
                                            })];
                                    case 2:
                                        res = _d.sent();
                                        if (!!res.ok) return [3 /*break*/, 4];
                                        return [4 /*yield*/, res.text()];
                                    case 3:
                                        reason = _d.sent();
                                        msg = "OpenAI error ".concat(res.status || res.statusText, ": ").concat(reason);
                                        error = new types.ChatGPTError(msg);
                                        error.statusCode = res.status;
                                        error.statusText = res.statusText;
                                        return [2 /*return*/, reject(error)];
                                    case 4: return [4 /*yield*/, res.json()];
                                    case 5:
                                        response = (_d.sent());
                                        if (this._debug) {
                                            console.log(response);
                                        }
                                        if (response === null || response === void 0 ? void 0 : response.id) {
                                            result.id = response.id;
                                        }
                                        if ((_b = response === null || response === void 0 ? void 0 : response.choices) === null || _b === void 0 ? void 0 : _b.length) {
                                            message = response.choices[0].message;
                                            if (message.content) {
                                                result.text = extractTextContent(message.content);
                                                result.originalContent = message.content;
                                            }
                                            else if (message.function_call && message.function_call !== null) {
                                                result.functionCall = message.function_call;
                                                result.toolCalls = [{
                                                        id: "call_".concat(uuidv4()),
                                                        type: 'function',
                                                        function: message.function_call
                                                    }];
                                            }
                                            else if (message.tool_calls && message.tool_calls.length > 0) {
                                                result.functionCall = message.tool_calls.map(function (tool) { return tool.function; })[0];
                                                result.toolCalls = message.tool_calls;
                                            }
                                            result.thinking_text = message.reasoning_content;
                                            if (message.role) {
                                                result.role = message.role;
                                            }
                                        }
                                        else {
                                            res_1 = response;
                                            console.error(res_1);
                                            return [2 /*return*/, reject(new Error("OpenAI error: ".concat(((_c = res_1 === null || res_1 === void 0 ? void 0 : res_1.detail) === null || _c === void 0 ? void 0 : _c.message) || (res_1 === null || res_1 === void 0 ? void 0 : res_1.detail) || 'unknown')))];
                                        }
                                        result.detail = response;
                                        result.conversation = messages;
                                        return [2 /*return*/, resolve(result)];
                                    case 6:
                                        err_1 = _d.sent();
                                        return [2 /*return*/, reject(err_1)];
                                    case 7: return [2 /*return*/];
                                }
                            });
                        }); }).then(function (message) { return __awaiter(_this, void 0, void 0, function () {
                            var promptTokens, completionTokens, err_2, cleanedCurrentMessages, cleanedResponse;
                            var _this = this;
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
                                    case 4:
                                        cleanedCurrentMessages = currentMessages.map(function (m) { return (__assign(__assign({}, m), { originalContent: _this._stripImages(m.originalContent) })); });
                                        cleanedResponse = __assign(__assign({}, message), { originalContent: this._stripImages(message.originalContent) });
                                        // 返回给当前调用的带图片的 message ，只是存入数据库的是无图片的 cleaned 版
                                        return [2 /*return*/, Promise.all(__spreadArray(__spreadArray([], cleanedCurrentMessages.map(function (currentMessage) { return _this._upsertMessage(currentMessage); }), true), [
                                                this._upsertMessage(cleanedResponse)
                                            ], false)).then(function () { return message; })];
                                }
                            });
                        }); });
                        if (timeoutMs) {
                            if (abortController) {
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
                        return [2 /*return*/, responseP];
                }
            });
        });
    };
    Object.defineProperty(ChatGPTAPI.prototype, "apiKey", {
        get: function () {
            return this._apiKey;
        },
        set: function (apiKey) {
            this._apiKey = apiKey;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(ChatGPTAPI.prototype, "apiOrg", {
        get: function () {
            return this._apiOrg;
        },
        set: function (apiOrg) {
            this._apiOrg = apiOrg;
        },
        enumerable: false,
        configurable: true
    });
    ChatGPTAPI.prototype._buildMessages = function (currentMessages, opts, completionParams) {
        return __awaiter(this, void 0, void 0, function () {
            var _a, systemMessage, parentMessageId, promptBudget, messages, systemMessageOffset, currentRequestMessages, nextMessages, currentTurnMessages, nextHistoryMessagesCount, nextToolChainCount, keptHistoryMessagesCount, keptToolChainCount, stopReason, functionToken, numTokens, nextNumTokensEstimate, _i, nextMessages_1, message, _b, isValidPrompt, includesOnlyCurrentTurn, parentMessage, storedRole, toolHistoryMessages, cursor, _c, assistantRequestMessage, toolRequestMessages, parentRequestMessage, maxTokens, attemptedHistoryMessages, droppedHistoryMessages;
            var _this = this;
            var _d, _e;
            return __generator(this, function (_f) {
                switch (_f.label) {
                    case 0:
                        _a = opts.systemMessage, systemMessage = _a === void 0 ? this._systemMessage : _a;
                        parentMessageId = (_d = currentMessages[0]) === null || _d === void 0 ? void 0 : _d.parentMessageId;
                        promptBudget = this._maxResponseTokens < this._maxModelTokens
                            ? this._maxModelTokens - this._maxResponseTokens
                            : this._maxModelTokens - 1;
                        messages = [];
                        if (systemMessage) {
                            messages.push({
                                role: 'system',
                                content: systemMessage
                            });
                        }
                        systemMessageOffset = messages.length;
                        currentRequestMessages = currentMessages
                            .map(function (message) { return _this._toRequestMessage(message); })
                            .filter(Boolean);
                        nextMessages = messages.concat(currentRequestMessages);
                        currentTurnMessages = currentRequestMessages.length;
                        nextHistoryMessagesCount = 0;
                        nextToolChainCount = 0;
                        keptHistoryMessagesCount = 0;
                        keptToolChainCount = 0;
                        stopReason = 'complete';
                        functionToken = 0;
                        numTokens = functionToken;
                        _f.label = 1;
                    case 1:
                        nextNumTokensEstimate = functionToken;
                        _i = 0, nextMessages_1 = nextMessages;
                        _f.label = 2;
                    case 2:
                        if (!(_i < nextMessages_1.length)) return [3 /*break*/, 5];
                        message = nextMessages_1[_i];
                        _b = nextNumTokensEstimate;
                        return [4 /*yield*/, this._getMessageTokenEstimate(message)];
                    case 3:
                        nextNumTokensEstimate = _b + _f.sent();
                        _f.label = 4;
                    case 4:
                        _i++;
                        return [3 /*break*/, 2];
                    case 5:
                        isValidPrompt = nextNumTokensEstimate <= promptBudget;
                        includesOnlyCurrentTurn = nextMessages.length === systemMessageOffset + currentRequestMessages.length;
                        if (includesOnlyCurrentTurn || isValidPrompt) {
                            messages = nextMessages;
                            numTokens = nextNumTokensEstimate;
                            keptHistoryMessagesCount = nextHistoryMessagesCount;
                            keptToolChainCount = nextToolChainCount;
                        }
                        if (!isValidPrompt) {
                            stopReason = 'budget';
                            return [3 /*break*/, 14];
                        }
                        if (this._chatgptBlockCount > 0 && nextHistoryMessagesCount >= this._chatgptBlockCount) {
                            stopReason = 'block_count_reached';
                            return [3 /*break*/, 14];
                        }
                        if (!parentMessageId) {
                            stopReason = 'no_parent';
                            return [3 /*break*/, 14];
                        }
                        return [4 /*yield*/, this._getMessageById(parentMessageId)];
                    case 6:
                        parentMessage = _f.sent();
                        if (!parentMessage) {
                            stopReason = 'missing_parent';
                            return [3 /*break*/, 14];
                        }
                        storedRole = getStoredMessageRole(parentMessage.role);
                        if (!(storedRole === 'tool')) return [3 /*break*/, 12];
                        toolHistoryMessages = [];
                        cursor = parentMessage;
                        _f.label = 7;
                    case 7:
                        if (!(cursor && getStoredMessageRole(cursor.role) === 'tool')) return [3 /*break*/, 11];
                        toolHistoryMessages.unshift(cursor);
                        if (!cursor.parentMessageId) return [3 /*break*/, 9];
                        return [4 /*yield*/, this._getMessageById(cursor.parentMessageId)];
                    case 8:
                        _c = _f.sent();
                        return [3 /*break*/, 10];
                    case 9:
                        _c = undefined;
                        _f.label = 10;
                    case 10:
                        cursor = _c;
                        return [3 /*break*/, 7];
                    case 11:
                        parentMessageId = cursor === null || cursor === void 0 ? void 0 : cursor.parentMessageId;
                        assistantRequestMessage = cursor ? this._toRequestMessage(cursor) : null;
                        toolRequestMessages = toolHistoryMessages
                            .map(function (message) { return _this._toRequestMessage(message); })
                            .filter(Boolean);
                        if ((assistantRequestMessage === null || assistantRequestMessage === void 0 ? void 0 : assistantRequestMessage.role) !== 'assistant' ||
                            !((_e = assistantRequestMessage.tool_calls) === null || _e === void 0 ? void 0 : _e.length) ||
                            toolRequestMessages.length !== toolHistoryMessages.length) {
                            stopReason = 'invalid_tool_chain';
                            return [3 /*break*/, 13];
                        }
                        nextMessages = nextMessages.slice(0, systemMessageOffset).concat(__spreadArray(__spreadArray([
                            assistantRequestMessage
                        ], toolRequestMessages, true), nextMessages.slice(systemMessageOffset), true));
                        nextHistoryMessagesCount += 1 + toolRequestMessages.length;
                        nextToolChainCount += 1;
                        return [3 /*break*/, 13];
                    case 12:
                        parentRequestMessage = this._toRequestMessage(parentMessage);
                        parentMessageId = parentMessage.parentMessageId;
                        if (!parentRequestMessage) {
                            stopReason = 'skip_unsupported_parent';
                            return [3 /*break*/, 13];
                        }
                        nextMessages = nextMessages.slice(0, systemMessageOffset).concat(__spreadArray([
                            parentRequestMessage
                        ], nextMessages.slice(systemMessageOffset), true));
                        nextHistoryMessagesCount += 1;
                        _f.label = 13;
                    case 13:
                        if (true) return [3 /*break*/, 1];
                        _f.label = 14;
                    case 14:
                        maxTokens = Math.max(1, this._maxResponseTokens);
                        attemptedHistoryMessages = nextHistoryMessagesCount;
                        droppedHistoryMessages = Math.max(0, attemptedHistoryMessages - keptHistoryMessagesCount);
                        return [2 /*return*/, {
                                messages: messages,
                                maxTokens: maxTokens,
                                numTokens: numTokens,
                                trimInfo: {
                                    currentTurnMessages: currentTurnMessages,
                                    promptBudget: promptBudget,
                                    attemptedHistoryMessages: attemptedHistoryMessages,
                                    keptHistoryMessages: keptHistoryMessagesCount,
                                    droppedHistoryMessages: droppedHistoryMessages,
                                    keptToolChainCount: keptToolChainCount,
                                    trimmed: droppedHistoryMessages > 0,
                                    stopReason: stopReason
                                }
                            }];
                }
            });
        });
    };
    ChatGPTAPI.prototype._getTokenCount = function (text) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (!text) {
                    return [2 /*return*/, 0];
                }
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
