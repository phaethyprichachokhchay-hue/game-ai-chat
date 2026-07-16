// api/chat.js
// Vercel serverless function — this runs on the server, never in the user's browser.
// The Anthropic API key lives here (as an environment variable), so it's never exposed to visitors.

const SYSTEM_PROMPT = `คุณคือ "GameLore" ผู้ช่วย AI ที่เชี่ยวชาญเรื่องเกมโดยเฉพาะ ครอบคลุมทั้งเกมดังระดับโลกและ (ที่สำคัญที่สุด) เกมที่ไม่ค่อยมีคนพูดถึง เกมอินดี้ เกมท้องถิ่น เกมเฉพาะกลุ่ม และเกมเล็กๆ ที่หาข้อมูลยาก
กติกาของคุณ:
1. ตอบเฉพาะคำถามที่เกี่ยวกับเกม เช่น กลไกเกม ตัวละคร บทเควส กลยุทธ์ การอัปเดต ข่าวเกม ประวัติเกม คำแนะนำเกมที่คล้ายกัน หรือวัฒนธรรมเกมมิ่ง
2. ถ้าผู้ใช้ถามเรื่องที่ไม่เกี่ยวกับเกมเลย ให้ปฏิเสธอย่างสุภาพและดึงกลับมาที่หัวข้อเกม
3. ถ้าไม่แน่ใจข้อมูลเกี่ยวกับเกมเล็กที่ไม่มีคนรู้จัก ให้บอกตามตรงว่าไม่มั่นใจ แทนที่จะกุข้อมูลขึ้นมา
4. ตอบเป็นภาษาไทย น้ำเสียงเป็นกันเอง กระตือรือร้นแบบเกมเมอร์ แต่ให้ข้อมูลที่มีประโยชน์จริง กระชับ ไม่ยืดเยื้อเกินไป`;

const rateLimit = new Map();
const LIMIT = 20;
const WINDOW_MS = 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimit.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'ถามถี่เกินไป รอสักครู่แล้วลองใหม่นะ' });
    return;
  }

  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages ต้องเป็น array และห้ามว่าง' });
    return;
  }

  const cleanMessages = messages
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

  if (cleanMessages.length === 0) {
    res.status(400).json({ error: 'ข้อความไม่ถูกต้อง' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY บน server' });
    return;
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: cleanMessages,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      res.status(response.status).json({ error: errData?.error?.message || 'Anthropic API error' });
      return;
    }

    const data = await response.json();
    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    res.status(200).json({ reply: text || 'ขอโทษด้วย ตอนนี้ตอบไม่ได้ ลองใหม่อีกครั้งนะ' });
  } catch (err) {
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ Anthropic API' });
  }
}
