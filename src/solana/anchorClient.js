// src/solana/index.js
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BN } from "bn.js";

// ---------------------------------------------------
// ESM __dirname fix
// ---------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------
// CONFIG
// ---------------------------------------------------
const RPC_URL = "https://api.devnet.solana.com";

// ✅ Load IDL
const IDL_PATH = path.join(__dirname, "wzn_staking.json");
const IDL = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));

// ✅ Load Admin Keypair
const ADMIN_KEYPAIR_PATH = path.join(__dirname, "admin.json");
const ADMIN_KEYPAIR = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(ADMIN_KEYPAIR_PATH, "utf8")))
);

// ✅ Get Program ID
// Use IDL metadata if present, else fallback
let PROGRAM_ID;
if (IDL.metadata?.address) {
  PROGRAM_ID = new PublicKey(IDL.metadata.address);
  console.log("[SOLANA] Using PROGRAM_ID from IDL.metadata:", PROGRAM_ID.toBase58());
} else if (IDL.address) {
  PROGRAM_ID = new PublicKey(IDL.address);
  console.log("[SOLANA] Using PROGRAM_ID from IDL.address:", PROGRAM_ID.toBase58());
} else {
  // fallback to hardcoded
  PROGRAM_ID = new PublicKey("2K3dJABqTuzGJ9SqZ4WLR9n1HmAZYgaMqvZfrEbWJ2gP");
  console.log("[SOLANA] Using hardcoded PROGRAM_ID:", PROGRAM_ID.toBase58());
}

// ---------------------------------------------------
// CONNECTION & PROVIDER
// ---------------------------------------------------
const connection = new Connection(RPC_URL, "confirmed");
const wallet = new Wallet(ADMIN_KEYPAIR);
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });

// ---------------------------------------------------
// PROGRAM
// ---------------------------------------------------
const program = new Program(IDL, provider);

// ---------------------------------------------------
// HELPERS
// ---------------------------------------------------
function getUserStatePda(userPubkey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user_state"), userPubkey.toBuffer()],
    PROGRAM_ID
  )[0];
}

function getConfigPda() {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID
  )[0];
}

// ---------------------------------------------------
// EXPORTED FUNCTIONS
// ---------------------------------------------------

/**
 * Fetches a user's play balance from chain.
 * @param {string} userPubkeyStr
 * @returns {Promise<number|null>}
 */
export async function getPlayBalance(userPubkeyStr) {
  if (
    !userPubkeyStr ||
    typeof userPubkeyStr !== "string" ||
    userPubkeyStr.length < 32
  ) {
    throw new Error(`Invalid userPubkeyStr: "${userPubkeyStr}"`);
  }

  const userPubkey = new PublicKey(userPubkeyStr);
  const userStatePda = getUserStatePda(userPubkey);

  try {
    const userState = await program.account.userState.fetch(userStatePda);
    const rawBalance = new BN(userState.playBalance); // safest

    // Format as float with 9 decimals
    const rawStr = rawBalance.toString().padStart(10, "0"); // ensure length ≥ 10
    const whole = rawStr.slice(0, -9) || "0";
    const fraction = rawStr.slice(-9);
    const formatted = `${whole}.${fraction}`;

    console.log(`[getPlayBalance] User: ${userPubkeyStr}, PlayBalance: ${formatted}`);
    return parseFloat(formatted);
  } catch (e) {
    console.error("[getPlayBalance] Error fetching userState:", e.message);
    return 0;
  }
}

/**
 * Calls resolve_balance instruction to adjust user play balance.
 * @param {string} userPubkeyStr
 * @param {number} amount (can be negative)
 * @returns {Promise<string>} tx signature
 */
export async function resolveBalance(userPubkeyStr, amount) {
  // Validate input
  if (!userPubkeyStr || typeof userPubkeyStr !== "string" || userPubkeyStr.length < 32) {
    throw new Error(`Invalid userPubkeyStr: "${userPubkeyStr}"`);
  }

  if (typeof amount !== "number" || isNaN(amount) || !Number.isFinite(amount)) {
    throw new Error(`Invalid amount: "${amount}"`);
  }

  const userPubkey = new PublicKey(userPubkeyStr);
  const userStatePda = getUserStatePda(userPubkey);
  const configPda = getConfigPda();

  // Convert amount to lamports (BN) with 9 decimals
  const lamportsBN = new BN(Math.floor(amount * 1e9));

  console.log(`[resolveBalance] Resolving for user ${userPubkeyStr}, amount ${amount} (${lamportsBN.toString()} lamports)`);

  const tx = await program.methods
    .resolveBalance(lamportsBN)
    .accounts({
      config: configPda,
      userState: userStatePda,
      authority: ADMIN_KEYPAIR.publicKey
    })
    .signers([ADMIN_KEYPAIR])
    .rpc();

  console.log("[resolveBalance] Tx Signature:", tx);
  return tx;
}
