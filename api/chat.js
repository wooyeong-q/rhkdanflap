import { GoogleGenAI } from "@google/genai";

function fallbackReply(message, mineral, context, records) {
  const name = mineral || "선택한 광물";
  const data = context || {};
  const q = String(message || "");

  if (q.includes("조흔")) {
    if (data.streakNoMark || name === "석영") return `${name}은 조흔색을 관찰하기 어렵습니다. 조흔판 위에서 움직인 경로는 보일 수 있지만 광물이 단단해서 가루 조흔 자국은 남지 않아요.`;
    return `${name}의 조흔색은 ${data.streak || "실험으로 확인해 보세요"}입니다. 조흔판 도구를 선택한 뒤 광물을 조흔판 위에서 문지르면 확인할 수 있어요.`;
  }
  if (q.includes("염산") || q.includes("기포") || q.includes("거품")) {
    return `${name}의 묽은 염산 반응은 ${data.acid || "실험으로 확인해 보세요"}입니다. 방해석처럼 탄산염 성분이 있는 광물은 묽은 염산에 기포가 생길 수 있어요.`;
  }
  if (q.includes("굳기") || q.includes("쇠못") || q.includes("손톱") || q.includes("동전") || q.includes("유리") || q.includes("긁")) {
    return `${name}의 굳기 비교 요약은 ${data.hardnessSummary || "실험으로 확인해 보세요"}입니다. 굳기 비교 도구를 선택한 뒤 손톱, 동전, 쇠못, 유리판 중 하나를 골라 실제 광물 부분에서 실험해 보세요.`;
  }
  if (q.includes("클립") || q.includes("자성") || q.includes("자석")) {
    return `${name}의 자성 확인 결과는 ${data.magnet || "실험으로 확인해 보세요"}입니다. 자철석은 철로 된 클립을 끌어당길 수 있지만 황철석과 황동석은 일반적으로 클립을 끌어당기지 않아요.`;
  }

  return `${name}의 현재 정보입니다.
겉보기색: ${data.color || "-"}
조흔색: ${data.streak || "-"}
굳기 비교: ${data.hardnessSummary || "-"}
염산 반응: ${data.acid || "-"}
클립 반응: ${data.magnet || "-"}`;
}

function extractGeminiText(response) {
  if (!response) return "";
  if (typeof response.text === "string") return response.text.trim();
  if (typeof response.text === "function") return String(response.text() || "").trim();
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part?.text || "").join("\n").trim();
}

function buildPrompt({ message, mineral, context, records }) {
  return `
당신은 중학교 과학 교사이며 현재 '광물 가상 실험실'에서 학생의 실험을 돕고 있습니다.

[현재 상황]
선택된 광물: ${mineral || "없음"}
광물 정보: ${JSON.stringify(context || {})}
학생의 현재 실험 기록: ${JSON.stringify(records || {})}

[과학 사실]
- 방해석은 묽은 염산에 거품 반응이 나타난다.
- 자철석은 자성을 띠어 철로 된 클립을 끌어당길 수 있다.
- 황철석은 금빛 광택이 나지만 일반적으로 자성을 띠지 않는다.
- 황동석은 황동색 금속 광택을 띠며 일반적으로 자성을 띠지 않는다.
- 황철석의 조흔색은 보통 흑녹색 또는 검은색이다.
- 황동석의 조흔색은 보통 흑녹색이다.
- 석영은 조흔판보다 단단해서 뚜렷한 가루 조흔이 잘 남지 않고 조흔색 관찰이 어렵다.

[학생 질문]
${message || ""}

[답변 규칙]
- 한국어로 답변하세요.
- 중학교 2학년 수준으로 설명하세요.
- 질문이 단순하면 짧게 답하고, 설명이 필요한 질문이면 8~12문장까지 충분히 자세히 답하세요.
- 필요한 경우 돋보기, 조흔판, 굳기 비교 도구(손톱, 동전, 쇠못, 유리판), 묽은 염산, 클립 도구 사용법을 안내하세요.
- 실험으로 확인해야 하는 내용은 단정하기보다 "실험으로 확인해 보자"처럼 말하세요.
- 석영 조흔 실험은 문지르는 경로는 보일 수 있지만 자국은 남지 않는다고 설명하세요.
- '자석 반응' 대신 '클립으로 자성 확인'이라고 표현해도 좋습니다.
`.trim();
}

async function generateWithModel(ai, model, prompt) {
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { temperature: 0.45, maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 1600) }
  });
  return extractGeminiText(response);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, mineral, context, records } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const primaryModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fallbackModels = ["gemini-2.5-flash-lite"].filter(m => m !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackModels];

  if (!apiKey) {
    return res.status(200).json({ source: "missing_api_key", reply: "Gemini API 키가 아직 연결되지 않았습니다. Vercel 프로젝트의 Settings → Environment Variables에서 GEMINI_API_KEY를 추가하고 Redeploy 해 주세요.\n\n" + fallbackReply(message, mineral, context, records) });
  }

  try {
    const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 20000, retryOptions: { attempts: 1 }, headers: { "User-Agent": "aistudio-build" } } });
    const prompt = buildPrompt({ message, mineral, context, records });
    const errors = [];
    for (const model of modelsToTry) {
      try {
        const reply = await generateWithModel(ai, model, prompt);
        if (reply) return res.status(200).json({ reply, source: "gemini_sdk", model });
        errors.push(`${model}: empty response`);
      } catch (modelError) {
        errors.push(`${model}: ${modelError?.message || String(modelError)}`);
      }
    }
    return res.status(200).json({ source: "gemini_model_error", reply: `Gemini 모델 호출이 실패했습니다. 시도한 모델: ${modelsToTry.join(", ")}\n오류: ${errors.join(" | ")}\n\n` + "Vercel 환경변수에 GEMINI_MODEL=gemini-2.5-flash 또는 GEMINI_MODEL=gemini-2.5-flash-lite를 넣고 Redeploy 해 보세요.\n\n" + fallbackReply(message, mineral, context, records) });
  } catch (error) {
    const details = error?.message || String(error || "unknown error");
    return res.status(200).json({ source: "gemini_sdk_error", reply: `Gemini API 연결 오류가 발생했습니다. 원인: ${details}\n\n` + "확인할 것: Vercel의 GEMINI_API_KEY 값이 정확한지, 저장 후 Redeploy 했는지 확인해 주세요.\n\n" + fallbackReply(message, mineral, context, records) });
  }
}
