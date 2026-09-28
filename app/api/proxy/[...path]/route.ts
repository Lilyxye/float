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

    // 读取请求体
    let body: any;
    try {
        body = await request.json();
    } catch {
        return forwardRaw(request, targetUrl);
    }

    const hasTools = body.tools && body.tools.length > 0;
    const isStream = body.stream === true;

    // ⭐ 没有 tools 或不是流式 → 直接透传
    if (!hasTools || !isStream) {
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

    // ⭐⭐⭐ 有 tools + 流式 → 改成非流式请求，再伪装成流式返回
    const newHeaders = buildHeaders(request);
    const nonStreamBody = { ...body, stream: false };

    let response: Response;
    try {
        response = await fetch(targetUrl, {
            method: 'POST',
            headers: newHeaders,
            body: JSON.stringify(nonStreamBody),
        });
    } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!response.ok) {
        const errText = await response.text();
        return new Response(errText, {
            status: response.status,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const data = await response.json();

    // 把非流式响应转成 SSE 流式格式
    const encoder = new TextEncoder();
    const id = data.id || 'chatcmpl-proxy';
    const model = data.model || body.model || 'unknown';
    const choice = data.choices?.[0];

    if (!choice) {
        return new Response(JSON.stringify(data), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const stream = new ReadableStream({
        async start(controller) {
            // 1. 先发 role
            const roleChunk = {
                id,
                object: 'chat.completion.chunk',
                model,
                choices: [{
                    index: 0,
                    delta: { role: 'assistant' },
                    finish_reason: null,
                }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

            // 2. 如果有 tool_calls，逐个发送
            if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
                for (let i = 0; i < choice.message.tool_calls.length; i++) {
                    const tc = choice.message.tool_calls[i];

                    // 先发 tool call 头部（id + type + function name）
                    const tcHeaderChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        model,
                        choices: [{
                            index: 0,
                            delta: {
                                tool_calls: [{
                                    index: i,
                                    id: tc.id,
                                    type: 'function',
                                    function: {
                                        name: tc.function.name,
                                        arguments: '',
                                    },
                                }],
                            },
                            finish_reason: null,
                        }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(tcHeaderChunk)}\n\n`));

                    // 再分块发 arguments
                    const args = tc.function.arguments || '';
                    const chunkSize = 20;
                    for (let j = 0; j < args.length; j += chunkSize) {
                        const slice = args.slice(j, j + chunkSize);
                        const tcArgChunk = {
                            id,
                            object: 'chat.completion.chunk',
                            model,
                            choices: [{
                                index: 0,
                                delta: {
                                    tool_calls: [{
                                        index: i,
                                        function: {
                                            arguments: slice,
                                        },
                                    }],
                                },
                                finish_reason: null,
                            }],
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(tcArgChunk)}\n\n`));
                    }
                }
            }

            // 3. 如果有文本内容，逐行发送
            if (choice.message?.content) {
                const lines = choice.message.content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const text = i < lines.length - 1 ? lines[i] + '\n' : lines[i];
                    if (!text) continue;
                    const textChunk = {
                        id,
                        object: 'chat.completion.chunk',
                        model,
                        choices: [{
                            index: 0,
                            delta: { content: text },
                            finish_reason: null,
                        }],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(textChunk)}\n\n`));
                    await new Promise(r => setTimeout(r, 15));
                }
            }

            // 4. 结束
            const endChunk = {
                id,
                object: 'chat.completion.chunk',
                model,
                choices: [{
                    index: 0,
                    delta: {},
                    finish_reason: choice.finish_reason || 'stop',
                }],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-store',
            'Connection': 'keep-alive',
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
