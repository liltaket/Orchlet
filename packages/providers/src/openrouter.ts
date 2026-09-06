import { Logger, QuotaExhaustedError, OrchletError } from "@orchlet/shared";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResult {
  text: string;
  model: string;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export class OpenRouterProvider {
  private apiKey: string | null;
  private baseUrl = "https://openrouter.ai/api/v1";
  private logger = new Logger({ prefix: "OpenRouterProvider" });

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.OPENROUTER_API_KEY || null;
  }

  async complete(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
    if (!this.apiKey) {
      throw new OrchletError(
        "OPENROUTER_API_KEY environment variable is not configured",
        "PROVIDER_CONFIG_ERROR",
      );
    }

    this.logger.debug(`Dispatching completion to OpenRouter: ${options.model}`);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/liltaket/Orchlet",
        "X-Title": "Orchlet Control Plane",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 4096,
      }),
    });

    if (response.status === 429) {
      throw new QuotaExhaustedError("OpenRouter rate limit or quota exceeded", "openrouter");
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new OrchletError(
        `OpenRouter API returned ${response.status}: ${errText}`,
        "PROVIDER_API_ERROR",
      );
    }

    const data = (await response.json()) as any;
    const choice = data.choices?.[0];
    const text = choice?.message?.content || "";

    return {
      text,
      model: data.model || options.model,
      tokensUsed: data.usage
        ? {
            prompt: data.usage.prompt_tokens,
            completion: data.usage.completion_tokens,
            total: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}

export const openRouterProvider = new OpenRouterProvider();
