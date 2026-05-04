import { Injectable, Logger } from '@nestjs/common';
import type { AIToolSchema } from './ai.service';

interface ToolCallResult {
  toolName: string;
  args: Record<string, unknown>;
}

@Injectable()
export class LlmAdapterService {
  private readonly logger = new Logger(LlmAdapterService.name);

  async resolveToolCall(
    input: string,
    tools: AIToolSchema[],
  ): Promise<ToolCallResult | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(`LLM 调用失败: status=${response.status}`);
        return null;
      }

      const body = (await response.json()) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              function?: {
                name?: string;
                arguments?: string;
              };
            }>;
          };
        }>;
      };

      const toolCall = body.choices?.[0]?.message?.tool_calls?.[0]?.function;
      if (!toolCall?.name) {
        return null;
      }

      const args = toolCall.arguments
        ? (JSON.parse(toolCall.arguments) as Record<string, unknown>)
        : {};

      return {
        toolName: toolCall.name,
        args,
      };
    } catch (error) {
      this.logger.warn(
        `LLM 路由失败，已回退规则引擎: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async resolveReadSql(
    question: string,
    schemaContext: string,
  ): Promise<string | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(`LLM SQL 生成失败: status=${response.status}`);
        return null;
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      return content
        .replace(/^```sql\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    } catch (error) {
      this.logger.warn(
        `LLM SQL 路由失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async resolveDocumentDraft(
    fileName: string,
  ): Promise<Record<string, unknown> | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
          }),
        },
      );

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return null;
      }

      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
