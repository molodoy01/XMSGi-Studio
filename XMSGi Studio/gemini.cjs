const { GoogleGenAI } = require('@google/genai');

const DEFAULT_MODEL = 'gemini-3.6-flash';
const MAX_PROMPT_LENGTH = 12000;
const intentSchema = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['schedule', 'clarify']
    },
    chat: { type: 'string' },
    message: { type: 'string' },
    date: { type: 'string' },
    time: { type: 'string' },
    clarification: { type: 'string' }
  },
  required: ['action', 'chat', 'message', 'date', 'time', 'clarification'],
  additionalProperties: false
};

let geminiClient = null;
let geminiClientKey = '';

function getApiKey(providedKey) {
  const apiKey = providedKey?.trim();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the Electron main process.');
  }

  return apiKey;
}

function getGeminiClient(apiKey) {
  if (!geminiClient || geminiClientKey !== apiKey) {
    geminiClient = new GoogleGenAI({ apiKey });
    geminiClientKey = apiKey;
  }

  return geminiClient;
}

async function generateGeminiContent(prompt, options = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Gemini prompt must be a non-empty string.');
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Gemini prompt exceeds the ${MAX_PROMPT_LENGTH}-character limit.`);
  }

  const apiKey = getApiKey(options.apiKey);

  const context = options.context || {};
  const chatList = Array.isArray(context.chats) ? context.chats : [];
  const parserPrompt = [
    'Parse the user request into an XMSGi scheduling intent.',
    'Return only JSON matching the provided schema.',
    'Use action "schedule" only when chat, message, date, and time are all clear.',
    'Use action "clarify" when any required detail is missing or ambiguous.',
    'For clarify, explain exactly what is missing or ambiguous in clarification.',
    'Use the current date and time as the reference for relative expressions.',
    'Select chat only from the available Telegram chat list and use its exact name.',
    `Current date: ${context.currentDate || 'unknown'}`,
    `Current time: ${context.currentTime || 'unknown'}`,
    `Available Telegram chats: ${JSON.stringify(chatList)}`,
    `User request: ${prompt.trim()}`
  ].join('\n');

  const response = await getGeminiClient(apiKey).models.generateContent({
    model: options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL,
    contents: parserPrompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: intentSchema
    }
  });

  let intent;

  try {
    intent = JSON.parse(response.text || '{}');
  } catch {
    throw new Error('Gemini returned invalid structured output.');
  }

  return intent;
}

module.exports = {
  generateGeminiContent
};
