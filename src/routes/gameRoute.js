import express from "express";
import * as solana from "../solana/anchorClient.js";

export function addGameRoute (app) {
    const router = express.Router();

    /**
     * POST /api/game/joinroom
     * Body: { userPubkey }
     * 
     * Returns:
     *   {
     *     canJoin: true/false,
     *     balance: number
     *   }
     */
    router.post("/joinroom", async (req, res) => {
    const { userPubkey } = req.body;

    console.log(userPubkey);
    if (!userPubkey || typeof userPubkey !== "string" || userPubkey.length < 32) {
        return res.status(400).json({ error: "Invalid userPubkey" });
    }

    try {
        const balance = await solana.getPlayBalance(userPubkey);

        if (balance === null) {
        return res.status(404).json({ error: "User not found on-chain" });
        }

        res.json({
        canJoin: balance > 0,
        balance
        });
    } catch (error) {
        console.error("[POST /api/game/joinroom] Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
    });


    /**
     * POST /api/game/resolve
     * Body: { userPubkey, amount }
     * 
     * Returns:
     *   {
     *     success: true,
     *     tx: string
     *   }
     */
    router.post("/resolve", async (req, res) => {
    const { userPubkey, amount } = req.body;

    if (!userPubkey || typeof amount !== "number") {
        return res.status(400).json({ error: "userPubkey and amount are required" });
    }

    try {
        const tx = await solana.resolveBalance(userPubkey, amount);
        res.json({ success: true, tx });
    } catch (error) {
        console.error("[POST /api/game/resolve] Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
    });

  /** Mount Router */
  app.use('/api/game', router);
}