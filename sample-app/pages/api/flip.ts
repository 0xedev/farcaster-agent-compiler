import { z } from "zod";

const FlipSchema = z.object({
  choice: z.enum(["heads", "tails"]),
  amount: z.number().min(0.01),
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const result = FlipSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.format() });
  }

  const isWin = Math.random() > 0.5;
  const outcome = isWin ? "win" : "lose";

  return res.status(200).json({
    result: outcome,
    payout: isWin ? result.data.amount * 2 : 0,
  });
}
