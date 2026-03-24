import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const callback = request.nextUrl.searchParams.get('__callback__');

  // 某些浏览器插件会发起 JSONP 探测请求，返回空成功响应以避免 404 噪音。
  if (callback) {
    const payload = JSON.stringify({ ok: true, action });
    return new NextResponse(`${callback}(${payload});`, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ ok: true, action }, { status: 200 });
}
