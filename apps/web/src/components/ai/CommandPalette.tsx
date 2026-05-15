'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Command, Loader2, Mic, MicOff, Sparkles, X } from 'lucide-react';
import api from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  card?: Record<string, unknown>;
  draft?: {
    originalInput: string;
    toolName: string;
    args: Record<string, unknown>;
    writeEnabled?: boolean;
  };
};

type SpeechRecognitionType = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionType;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function formatCard(card?: Record<string, unknown>) {
  if (!card) return null;
  return Object.entries(card).map(([key, value]) => ({
    key,
    value: typeof value === 'object' ? JSON.stringify(value) : String(value),
  }));
}

export function CommandPalette() {
  const { language, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionType | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac');
      const trigger = isMac ? event.metaKey : event.ctrlKey;
      if (trigger && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const openByEvent = () => setOpen(true);
    window.addEventListener('erp:open-command-palette', openByEvent as EventListener);
    return () => {
      window.removeEventListener('erp:open-command-palette', openByEvent as EventListener);
    };
  }, []);

  const placeholder = useMemo(
    () => t('aiPlaceholder'),
    [language],
  );

  const SpeechRecognition =
    typeof window !== 'undefined'
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;
  const speechSupported = !!SpeechRecognition;

  const toggleVoiceInput = () => {
    if (!speechSupported) {
      return;
    }

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const result = event.results?.[event.results.length - 1];
      const transcript = result?.[0]?.transcript;
      if (transcript) {
        setInput(transcript.trim());
      }
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const renderWidget = (card?: Record<string, unknown>) => {
    if (!card) return null;

    if (card.widgetType === 'receivable') {
      return (
        <div className="mt-3 rounded-xl border border-cyan-200 bg-cyan-50 p-3">
          <div className="text-xs uppercase tracking-wide text-cyan-700">{t('aiReceivableWidget')}</div>
          <p className="mt-1 text-sm font-semibold text-cyan-900">{String(card.partnerName ?? t('aiCustomer'))}</p>
          <p className="mt-1 text-lg font-bold text-cyan-900">¥{String(card.amount ?? '0')}</p>
          <p className="mt-1 text-xs text-cyan-800">{t('aiUnpaidCount')}: {String(card.unpaidCount ?? '0')}</p>
        </div>
      );
    }

    const rows = formatCard(card);
    if (!rows?.length) return null;

    return (
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
        {rows.map((row) => (
          <div key={row.key} className="rounded bg-white px-2 py-1">
            <span className="text-slate-500">{row.key}:</span> {row.value}
          </div>
        ))}
      </div>
    );
  };

  const runCommand = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMessage: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.post('/v1/ai/command', { input: text, dryRun: true });
      const assistantMessage: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: response.data?.message || t('aiExecuted'),
        card: response.data?.card,
        draft: response.data?.type === 'draft' ? response.data?.draft : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error: any) {
      const assistantMessage: Message = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        text: error?.response?.data?.message || t('aiExecuteFailed'),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-1.5 text-sm text-slate-600 shadow-sm backdrop-blur hover:bg-white"
      >
        <Command className="h-4 w-4" />
        <span>{t('aiCommand')}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">Ctrl/⌘ K</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] bg-slate-900/30 backdrop-blur-sm">
          <div className="mx-auto mt-16 w-[min(900px,92vw)] overflow-hidden rounded-2xl border border-white/40 bg-white/75 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3">
              <div className="flex items-center gap-2 text-slate-700">
                <Sparkles className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-medium">{t('aiCopilotTitle')}</span>
              </div>
              <button onClick={() => setOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[55vh] space-y-3 overflow-auto px-4 py-4">
              {messages.length === 0 && !loading && (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">
                  {t('aiEmpty')}
                </div>
              )}

              {messages.map((msg) => {
                return (
                  <div
                    key={msg.id}
                    className={`rounded-xl border p-3 ${
                      msg.role === 'user'
                        ? 'ml-8 border-cyan-200 bg-cyan-50 text-cyan-900'
                        : 'mr-8 border-slate-200 bg-white text-slate-800'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2 text-xs opacity-70">
                      {msg.role === 'user' ? <Command className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                      <span>{msg.role === 'user' ? 'You' : 'Copilot'}</span>
                    </div>
                    <p className="text-sm leading-6">{msg.text}</p>

                    {renderWidget(msg.card)}
                    {msg.draft ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-800">{t('aiDraftAction')}: {msg.draft.toolName}</p>
                        {msg.draft.writeEnabled === false ? (
                          <p className="mt-1 text-xs text-amber-700">
                            {t('aiWriteDisabled')}
                          </p>
                        ) : null}
                        <pre className="mt-1 overflow-auto rounded bg-white p-2 text-[11px] text-slate-600">
                          {JSON.stringify(msg.draft.args, null, 2)}
                        </pre>
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            disabled={msg.draft.writeEnabled === false}
                            className="rounded-md bg-amber-600 px-3 py-1 text-xs text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={async () => {
                              try {
                                setLoading(true);
                                const confirmResp = await api.post('/v1/ai/command', {
                                  input: msg.draft?.originalInput,
                                  dryRun: false,
                                  overrideTool: {
                                    toolName: msg.draft?.toolName,
                                    args: msg.draft?.args,
                                  },
                                });
                                const confirmed: Message = {
                                  id: `a-${Date.now()}-confirm`,
                                  role: 'assistant',
                                  text: confirmResp.data?.message || t('aiConfirmed'),
                                  card: confirmResp.data?.card,
                                };
                                setMessages((prev) => [...prev, confirmed]);
                              } catch (error: any) {
                                const failed: Message = {
                                  id: `a-${Date.now()}-failed`,
                                  role: 'assistant',
                                  text: error?.response?.data?.message || t('aiConfirmFailed'),
                                };
                                setMessages((prev) => [...prev, failed]);
                              } finally {
                                setLoading(false);
                              }
                            }}
                          >
                            Confirm
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {loading && (
                <div className="mr-8 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
                  <div className="mb-2 flex items-center gap-2 text-xs opacity-70">
                    <Bot className="h-3.5 w-3.5" /> Copilot
                  </div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-600" /> {t('aiThinking')}
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-slate-200/70 bg-white/80 px-4 py-3">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runCommand();
                    }
                  }}
                  placeholder={placeholder}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                />
                <button
                  type="button"
                  onClick={toggleVoiceInput}
                  disabled={!speechSupported}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title={speechSupported ? t('voiceInput') : t('voiceUnsupported')}
                >
                  {listening ? <MicOff className="h-4 w-4 text-rose-600" /> : <Mic className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => void runCommand()}
                  disabled={loading}
                  className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:opacity-60"
                >
                  {t('commonSend')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
