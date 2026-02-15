import { NextRequest, NextResponse } from "next/server";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const cleanId = id.endsWith(".pdf") ? id.replace(".pdf", "") : id;
    const arxivUrl = `https://arxiv.org/pdf/${cleanId}.pdf`;

    try {
        const response = await fetch(arxivUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
            },
        });

        if (!response.ok) {
            // Fallback or error
            return new NextResponse(`Failed to fetch PDF from arXiv: ${response.statusText}`, { status: response.status });
        }

        const headers = new Headers();
        headers.set("Content-Type", "application/pdf");
        // headers.set("Content-Disposition", "inline"); // inline is default for PDF
        headers.set("Cache-Control", "public, max-age=31536000, immutable");

        return new NextResponse(response.body, {
            status: 200,
            headers: headers,
        });
    } catch (error) {
        console.error("PDF Proxy Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
