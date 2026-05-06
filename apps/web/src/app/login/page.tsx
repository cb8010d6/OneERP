"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAxiosError } from "axios";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import api from "../../lib/api";
import { useAuthStore } from "../../store/authStore";

function getLoginErrorMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }

  if (isAxiosError(error)) {
    const serverMessage = error.response?.data?.message;
    if (typeof serverMessage === "string" && serverMessage.trim()) {
      return serverMessage;
    }

    if (error.response?.status) {
      return `登录接口返回 ${error.response.status}，请检查账号密码或后端认证服务。`;
    }

    if (error.code === "ECONNABORTED") {
      return "登录接口请求超时，请确认 API 服务正在 8000 端口运行。";
    }

    if (error.message) {
      return `无法连接登录接口：${error.message}`;
    }
  }

  return "邮箱或密码错误，或系统未启动";
}

export default function LoginPage() {
  const [email, setEmail] = useState("admin@erp.com");
  const [password, setPassword] = useState("admin");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const router = useRouter();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await api.post("/auth/login", { email, password });
      const { accessToken, user, companies } = res.data;
      const normalizedUser = {
        ...user,
        username: user?.username ?? user?.name ?? user?.email ?? "Admin",
        role: user?.role ?? companies?.[0]?.role ?? "Administrator",
      };

      setAuth(accessToken, normalizedUser, companies);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-slate-950 text-slate-900 lg:grid-cols-[1fr_480px]">
      <section className="hidden min-h-screen flex-col justify-between bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.22),transparent_28%),linear-gradient(135deg,#020617_0%,#0f172a_46%,#111827_100%)] p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-sky-500 shadow-lg shadow-sky-950/30">
            <Building2 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-wide text-sky-100">
              OneERP
            </div>
            <div className="text-xs uppercase tracking-[0.22em] text-slate-400">
              Operations Platform
            </div>
          </div>
        </div>

        <div className="max-w-2xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-sky-100">
            <ShieldCheck className="h-3.5 w-3.5" />
            多公司 · 供应链 · 财务 · 库存统一工作台
          </div>
          <h1 className="max-w-xl text-5xl font-semibold leading-tight tracking-normal">
            制造企业的一体化业务运营中枢
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300">
            用统一身份、租户隔离和业务流程引擎承载订单、库存、采购、财务与 AI
            辅助分析。
          </p>
        </div>

        <div className="grid max-w-2xl grid-cols-3 gap-3 text-sm text-slate-300">
          {["流程可追溯", "多公司隔离", "AI 辅助分析"].map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-3"
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-300" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white">
              <Building2 className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold text-slate-950">OneERP</h1>
            <p className="mt-1 text-sm text-slate-500">企业业务运营中枢</p>
          </div>

          <div className="mb-7">
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Secure Sign In
            </div>
            <h2 className="mt-2 text-3xl font-semibold text-slate-950">
              登录 OneERP
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              进入业务工作台，继续处理订单、库存、采购与财务任务。
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                登录账号
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 pl-10 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="admin@erp.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                密码
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  required
                  className="w-full rounded-lg border border-slate-200 bg-white p-3 pl-10 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                  placeholder="请输入密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? "正在登录..." : "进入工作台"}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>

            <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
              本地演示账号已默认填充。正式环境请接入企业身份源并关闭默认账号。
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
