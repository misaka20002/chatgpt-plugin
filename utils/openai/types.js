export class ChatGPTError extends Error {
    statusCode;
    statusText;
    isFinal;
    accountId;
}
export var openai;
(function (openai) {
})(openai || (openai = {}));
