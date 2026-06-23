const readline = require("readline");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

let sock, saveCreds;

async function startBot() {
    const { state, saveCreds: save } = await useMultiFileAuthState("./session");
    saveCreds = save;

    // Use a fixed version (speeds up start)
    const version = [6, 0, 0]; // Change if needed

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"], // Faster handshake
        connectTimeout: 30000, // 30s timeout
        defaultQueryTimeoutMs: 30000
    });

    sock.ev.on("creds.update", saveCreds);

    // Pairing flow (only first time)
    if (!state.creds.registered) {
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
                console.log("➡️  Enter the code above.\n");
            } catch (err) {
                console.error("❌ Pairing error:", err);
            }
            rl.close();
        });
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log("✅ Bot connected successfully!");
        }
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 2s...");
                setTimeout(startBot, 2000);
            } else {
                console.log("❌ Logged out. Delete session folder and restart.");
            }
        }
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const jid = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        try {
            await sock.sendPresenceUpdate("composing", jid);
            await sock.sendMessage(jid, { react: { text: "⚡", key: msg.key } });
            if (text === ".menu") {
                await sock.sendMessage(jid, {
                    text: `╭─❍ BOT\n├ .menu\n├ .ping\n├ .owner\n├ .away\n╰────────`
                });
            }
            if (text === ".ping") {
                await sock.sendMessage(jid, { text: "Pong ⚡" });
            }
            if (text === ".away" || text === ".owner" || text.toLowerCase().includes("veldrix")) {
                await sock.sendMessage(jid, { text: "Veldrix is not online." });
            }
        } catch (e) {
            console.log(e);
        }
    });
}

console.log("🚀 Starting bot...");
startBot();
