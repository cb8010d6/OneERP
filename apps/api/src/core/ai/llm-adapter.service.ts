import { Injectable, Logger } from '@nestjs/common';
import type { AIToolSchema } from './ai.service';
import { AISettingsService, AIModelPurpose } from './ai-settings.service';

interface ToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content?: string;
  tool_calls?: Array<{
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: ChatMessage;
  }>;
}

@Injectable()
export class LlmAdapterService {
  private readonly logger = new Logger(LlmAdapterService.name);

  constructor(private readonly aiSettingsService: AISettingsService) {}

  async resolveToolCall(
    input: string,
    tools: AIToolSchema[],
    companyId: string,
  ): Promise<ToolCallResult | null> {
    const config = await this.aiSettingsService.getEffectiveSettings(companyId);
    if (!config.apiKey || config.provider !== 'openai-compatible') {
      return null;
    }

    const response = await this.postChatCompletion(
      config,
      {
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content:
              '你是企业ERP动作路由器。你的任务是选择最合适的工具并给出JSON参数，不要输出自然语言解释。',
          },
          {
            role: 'user',
            content: input,
          },
        ],
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: 'auto',
      },
      'tool-router',
    );

    const toolCall =
      this.extractToolCall(response) ??
      (await this.resolveToolCallWithJsonFallback(input, tools, companyId));

    return toolCall;
  }

  async resolveReadSql(
    question: string,
    schemaContext: string,
    companyId: string,
  ): Promise<string | null> {
    const response = await this.postForPurpose(
      companyId,
      'sql',
      {
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              '你是SQL只读路由器。严格输出一条SQL字符串，且必须为SELECT，必须使用companyId=$1过滤。不要返回解释。',
          },
          {
            role: 'user',
            content: `Schema Context:\n${schemaContext}\n\nQuestion:\n${question}`,
          },
        ],
      },
      'chat2sql',
    );

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return null;
    }

    return content
      .replace(/^```sql\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/i, '')
      .trim();
  }

  async resolveDocumentDraft(
    fileName: string,
    companyId: string,
  ): Promise<Record<string, unknown> | null> {
    const response = await this.postForPurpose(
      companyId,
      'document',
      {
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '根据文件名推测一份采购发票草稿JSON，字段: supplierName, amount, taxRate, invoiceNo, lines。不确定就填默认值。',
          },
          {
            role: 'user',
            content: fileName,
          },
        ],
      },
      'document-draft',
    );

    const content = response?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return null;
    }

    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async postForPurpose(
    companyId: string,
    purpose: AIModelPurpose,
    payload: Record<string, unknown>,
    context: string,
  ) {
    const config = await this.aiSettingsService.getEffectiveSettings(
      companyId,
      purpose,
    );
    if (!config.apiKey || config.provider !== 'openai-compatible') {
      return null;
    }
    return this.postChatCompletion(
      config,
      { ...payload, model: config.model },
      context,
    );
  }

  private async resolveToolCallWithJsonFallback(
    input: string,
    tools: AIToolSchema[],
    companyId: string,
  ): Promise<ToolCallResult | null> {
    const config = await this.aiSettingsService.getEffectiveSettings(companyId);
    if (!config.apiKey || config.provider !== 'openai-compatible') {
      return null;
    }

    const response = await this.postChatCompletion(
      config,
      {
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              '你是企业ERP动作路由器。只输出JSON: {"toolName":"工具名","args":{...}}。如果没有合适工具，输出 {"toolName":"","args":{}}。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              input,
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              })),
            }),
          },
        ],
      },
      'tool-router-json',
    );

    return this.extractToolCall(response);
  }

  private extractToolCall(
    body: ChatCompletionResponse | null,
  ): ToolCallResult | null {
    const message = body?.choices?.[0]?.message;
    const functionCall = message?.tool_calls?.[0]?.function;
    if (functionCall?.name) {
      return {
        toolName: functionCall.name,
        args: this.parseArgs(functionCall.arguments),
      };
    }

    if (!message?.content) {
      return null;
    }

    try {
      const parsed = JSON.parse(message.content) as {
        toolName?: unknown;
        args?: unknown;
      };
      if (typeof parsed.toolName !== 'string' || !parsed.toolName) {
        return null;
      }
      return {
        toolName: parsed.toolName,
        args:
          parsed.args && typeof parsed.args === 'object'
            ? (parsed.args as Record<string, unknown>)
            : {},
      };
    } catch {
      return null;
    }
  }

  private parseArgs(value?: string) {
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async postChatCompletion(
    config: {
      baseUrl: string;
      apiKey: string;
      timeoutMs: number;
    },
    payload: Record<string, unknown>,
    context: string,
  ): Promise<ChatCompletionResponse | null> {
    try {
      const response = await fetch(
        this.aiSettingsService.buildChatCompletionsUrl(config.baseUrl),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(config.timeoutMs),
        },
      );

      if (!response.ok) {
        this.logger.warn(`LLM ${context} 调用失败: status=${response.status}`);
        return null;
      }

      return (await response.json()) as ChatCompletionResponse;
    } catch (error) {
      this.logger.warn(
        `LLM ${context} 调用失败: ${this.redactError(error, config.apiKey)}`,
      );
      return null;
    }
  }

  private redactError(error: unknown, secret: string) {
    const raw = error instanceof Error ? error.message : String(error);
    return raw.split(secret).join('[REDACTED]');
  }
}
