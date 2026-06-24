const readline = require("readline");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

let sock, saveCreds;
let isPairing = false;

async function startBot() {
    const { state, saveCreds: save } = await useMultiFileAuthState("./session");
    saveCreds = save;

    // Fast, stable version (skip network fetch)
    const version = [2, 3000, 1015906];

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeout: 30000,
        defaultQueryTimeoutMs: 30000
    });

    sock.ev.on("creds.update", saveCreds);

    // ------ Connection handler ------
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log("✅ Bot connected.");
            // If not registered, start pairing (only once)
            if (!state.creds.registered && !isPairing) {
                setTimeout(startPairing, 2000);
            }
        }

        if (connection === "close") {
            if (isPairing) {
                console.log("⏳ Waiting for pairing input... (ignore disconnect)");
                return;
            }
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 5s...");
                setTimeout(startBot, 5000);
            } else {
                console.log("❌ Logged out. Delete session folder and restart.");
            }
        }
    });

    // ------ Message handler (your exact commands) ------
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const jid = msg.key.remoteJid;
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "";

        try {
            // Fast presence & reaction (fire‑and‑forget)
            sock.sendPresenceUpdate("composing", jid).catch(() => {});
            sock.sendMessage(jid, {
                react: { text: "⚡", key: msg.key }
            }).catch(() => {});

            // Commands
            if (text === ".menu") {
                await sock.sendMessage(jid, {
                    text: `╭─❍ BOT\n├ .menu\n├ .ping\n├ .owner\n├ .away\n╰────────`
                });
            } else if (text === ".ping") {
                await sock.sendMessage(jid, { text: "Pong ⚡" });
            } else if (text === ".away" || text === ".owner" || text.toLowerCase().includes("veldrix")) {
                await sock.sendMessage(jid, { text: "Veldrix is not online." });
            }
        } catch (e) {
            console.log(e);
        }
    });

    if (state.creds.registered) {
        console.log("✅ Session found – waiting for connection...");
    }
}

// ------ Pairing function – only called after connection is open ------
function startPairing() {
    if (isPairing) return;
    isPairing = true;
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question("Enter phone number with country code: ", async (number) => {
        try {
            console.log("⏳ Requesting pairing code...");
            const code = await sock.requestPairingCode(number);
            console.log("\n✅ PAIRING CODE:", code);
            console.log("\n📲 Open WhatsApp → Settings → Linked Devices → Link with phone number");
            console.log("➡️  Enter the code above within 30 seconds.\n");
        } catch (err) {
            console.error("❌ Pairing failed:", err.message);
            console.log("💡 Retry in 10 seconds...");
            setTimeout(() => {
                isPairing = false;
                startBot();
            }, 10000);
        }
        rl.close();
        isPairing = false;
    });
}

console.log("🚀 Starting bot...");
startBot();
