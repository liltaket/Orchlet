import { Logger, OrchletError } from "@orchlet/shared";
import { openRouterProvider, type OpenRouterProvider } from "./openrouter.js";

export interface ReviewerCompletionRequest {
  systemPrompt: string;
  userMessage: string;
  model: string;
  temperature?: number;
  responseFormat?: { type: string };
}

export interface ReviewerCompletionResponse {
  text: string;
  model: string;
  tokensUsed?: { prompt: number; completion: number; total: number };
  costEstimate?: number;
}

export interface IReviewerProvider {
  readonly providerId: string;
  completeReview(request: ReviewerCompletionRequest): Promise<ReviewerCompletionResponse>;
}

export class OpenRouterReviewerProvider implements IReviewerProvider {
  readonly providerId = "openrouter";

  constructor(private client: OpenRouterProvider = openRouterProvider) {}

  async completeReview(request: ReviewerCompletionRequest): Promise<ReviewerCompletionResponse> {
    const res = await this.client.complete({
      model: request.model,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      temperature: request.temperature ?? 0.1,
      responseFormat: request.responseFormat,
    });

    return {
      text: res.text,
      model: res.model,
      tokensUsed: res.tokensUsed,
      costEstimate: res.costUsd,
    };
  }
}

export class ReviewerProviderRegistry {
  private providers = new Map<string, IReviewerProvider>();
  private logger = new Logger({ prefix: "ReviewerProviderRegistry" });

  constructor() {
    this.register(new OpenRouterReviewerProvider());
  }

  register(provider: IReviewerProvider): void {
    this.providers.set(provider.providerId.toLowerCase(), provider);
    this.logger.debug(`Registered reviewer provider: ${provider.providerId}`);
  }

  get(providerId: string): IReviewerProvider | undefined {
    return this.providers.get(providerId.toLowerCase());
  }

  listRegistered(): string[] {
    return Array.from(this.providers.keys());
  }

  resolve(providerId: string): IReviewerProvider {
    const normalized = providerId.toLowerCase();
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new OrchletError(
        `Unsupported reviewer provider '${providerId}'. Supported reviewer providers: ${this.listRegistered().join(", ")}`,
        "UNSUPPORTED_REVIEW_PROVIDER",
      );
    }
    return provider;
  }
}

export const reviewerProviderRegistry = new ReviewerProviderRegistry();
