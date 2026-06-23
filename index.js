const readline = require("readline");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

let sock, saveCreds;
let isPairing = false; // Flag to stop reconnection during pairing

async function startBot() {
    const { state, saveCreds: save } = await useMultiFileAuthState("./session");
    saveCreds = save;

    sock = makeWASocket({
        version: [6, 0, 0],
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeout: 30000,
        defaultQueryTimeoutMs: 30000
    });

    sock.ev.on("creds.update", saveCreds);

    // Pairing flow – only if not registered
    if (!state.creds.registered && !isPairing) {
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
                console.log("💡 Try again: delete session folder and restart.");
            }
            rl.close();
            isPairing = false; // Allow reconnection after pairing attempt
        });
    }

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "open") {
            console.log("✅ Bot connected successfully!");
        }
        if (connection === "close") {
            if (isPairing) {
                console.log("⏳ Waiting for pairing input... (ignore disconnect)");
                return; // Do NOT reconnect while pairing
            }
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 3s...");
                setTimeout(startBot, 3000);
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
