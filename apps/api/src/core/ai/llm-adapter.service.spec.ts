import { LlmAdapterService } from './llm-adapter.service';

function createService(responseBody: unknown) {
  const aiSettingsService = {
    getEffectiveSettings: jest.fn(() =>
      Promise.resolve({
        provider: 'openai-compatible',
        baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
        apiKey: 'secret-test-key',
        model: 'mimo-v2.5',
        defaultModel: 'mimo-v2.5',
        proModel: 'mimo-v2.5-pro',
        useProForSql: true,
        useProForDocuments: true,
        timeoutMs: 30000,
      }),
    ),
    buildChatCompletionsUrl: jest.fn(
      (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
    ),
  };
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(responseBody),
  } as Response);

  return {
    service: new LlmAdapterService(aiSettingsService as never),
    aiSettingsService,
    fetchMock,
  };
}

describe('LlmAdapterService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the configured OpenAI-compatible endpoint and parses tool calls', async () => {
    const { service, fetchMock } = createService({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: 'create_resource',
                  arguments: '{"modelName":"partner","data":{"name":"客户A"}}',
                },
              },
            ],
          },
        },
      ],
    });

    const result = await service.resolveToolCall(
      '创建客户A',
      [
        {
          name: 'create_resource',
          description: 'create',
          parameters: { type: 'object' },
        },
      ],
      'c1',
    );

    expect(result).toEqual({
      toolName: 'create_resource',
      args: { modelName: 'partner', data: { name: '客户A' } },
    });
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://token-plan-sgp.xiaomimimo.com/v1/chat/completions',
    );
    expect((requestInit.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-test-key',
    );
  });

  it('uses the pro model for Chat2SQL when configured', async () => {
    const { service, aiSettingsService } = createService({
      choices: [
        {
          message: {
            content:
              'select "status", count(*) from "Order" where "companyId" = $1 group by "status" limit 10',
          },
        },
      ],
    });

    const sql = await service.resolveReadSql('订单状态', 'schema', 'c1');

    expect(sql).toContain('"companyId" = $1');
    expect(aiSettingsService.getEffectiveSettings).toHaveBeenCalledWith(
      'c1',
      'sql',
    );
  });
});
