import { NextRequest } from 'next/server';

const TARGET_BASE = 'https://emtf.aipm9527.site';

export const runtime = 'edge';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    const targetPath = '/' + path.join('/');
    const targetUrl = TARGET_BASE + targetPath;

    let body: any;
    try {
        body = await request.json();
    } catch {
        return forwardRaw(request, targetUrl);
    }

    // 修复 thinking 模型 temperature 必须为 1
    if (body.model?.includes('thinking')) {
        body.temperature = 1;
    }

    // 删掉所有会导致中转站报错的参数
    delete body.frequency_penalty;
    delete body.presence_penalty;
    delete body.top_p;
    delete body.top_k;
    delete body.logprobs;
    delete body.top_logprobs;
    delete body.logit_bias;
    delete body.n;
    delete body.seed;
    delete body.user;
    delete body.response_format;
    delete body.service_tier;

    const newHeaders = buildHeaders(request);

    const response = await fetch(targetUrl, {
        method: 'POST',
        headers: newHeaders,
        body: JSON.stringify(body),
    });

    return new Response(response.body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            'X-Accel-Buffering': 'no',
        },
    });
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path } = await params;
    const targetPath = '/' + path.join('/');
    const targetUrl = TARGET_BASE + targetPath;

    const newHeaders = buildHeaders(request);
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

function buildHeaders(request: NextRequest): Headers {
    const newHeaders = new Headers();
    const auth = request.headers.get('authorization');
    const contentType = request.headers.get('content-type');
    if (auth) newHeaders.set('Authorization', auth);
    if (contentType) newHeaders.set('Content-Type', contentType);
    newHeaders.set('User-Agent', 'RikkaHub/1.0');
    newHeaders.set('Accept', '*/*');
    return newHeaders;
}

async function forwardRaw(request: NextRequest, targetUrl: string) {
    const newHeaders = buildHeaders(request);
    const response = await fetch(targetUrl, {
        method: request.method,
        headers: newHeaders,
        body: request.body,
    });
    return new Response(response.body, {
        status: response.status,
        headers: {
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
        },
    });
}
