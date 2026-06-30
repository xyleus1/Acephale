import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 503 });
  }

  const formData = await req.formData();
  const file = formData.get("audio");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: file as File,
      model: "whisper-1",
      response_format: "text",
    });

    return NextResponse.json({ transcript: transcription });
  } catch (e) {
    console.error("Whisper transcription error:", e);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
