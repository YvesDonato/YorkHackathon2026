import { NextRequest, NextResponse } from "next/server";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const cleanId = id.endsWith(".pdf") ? id.replace(".pdf", "") : id;
    const arxivUrl = `https://arxiv.org/pdf/${cleanId}.pdf`;
    const rangeHeader = request.headers.get("range");

    try {
        const upstreamHeaders = new Headers({
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        });

        if (rangeHeader) {
            upstreamHeaders.set("Range", rangeHeader);
        }

        const response = await fetch(arxivUrl, {
            headers: upstreamHeaders,
        });

        if (!response.ok) {
            // Fallback or error
            return new NextResponse(`Failed to fetch PDF from arXiv: ${response.statusText}`, { status: response.status });
        }

        const headers = new Headers();
        headers.set("Content-Type", response.headers.get("content-type") ?? "application/pdf");
        headers.set("Cache-Control", response.headers.get("cache-control") ?? "public, max-age=86400");

        const passthroughHeaders = [
            "accept-ranges",
            "content-length",
            "content-range",
            "etag",
            "last-modified",
        ];

        for (const headerName of passthroughHeaders) {
            const headerValue = response.headers.get(headerName);
            if (headerValue) {
                headers.set(headerName, headerValue);
            }
        }

        return new NextResponse(response.body, {
            status: response.status,
            headers: headers,
        });
    } catch (error) {
        console.error("PDF Proxy Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
