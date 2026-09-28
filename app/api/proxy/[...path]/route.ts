import { NextRequest } from 'next/server';

const TARGET_BASE = 'https://emtf.aipm9527.site';

export const runtime = 'edge';  // 用 Edge Runtime 支持流式

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    const targetPath = '/' + path.join('/');
    const targetUrl = TARGET_BASE + targetPath;

    // 只保留必要的头，去掉浏览器特征
    const newHeaders = new Headers();
    const auth = request.headers.get('authorization');
    const contentType = request.headers.get('content-type');
    
    if (auth) newHeaders.set('Authorization', auth);
    if (contentType) newHeaders.set('Content-Type', contentType);
    newHeaders.set('User-Agent', 'RikkaHub/1.0');
    newHeaders.set('Accept', '*/*');
    newHeaders.set('Connection', 'keep-alive');

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: newHeaders,
        body: request.body,
    });

    // 流式透传
    return new Response(response.body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            'X-Accel-Buffering': 'no',
        },
    });
}

// 也支持 GET（比如 /v1/models）
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    const targetPath = '/' + path.join('/');
    const targetUrl = TARGET_BASE + targetPath;

    const newHeaders = new Headers();
    const auth = request.headers.get('authorization');
    if (auth) newHeaders.set('Authorization', auth);
    newHeaders.set('User-Agent', 'RikkaHub/1.0');

    const response = await fetch(targetUrl, {
        method: 'GET',
        headers: newHeaders,
    });

    return new Response(response.body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
        },
    });
}
