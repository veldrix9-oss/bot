const readline = require("readline");
const pino = require("pino");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

let sock, saveCreds;
let isPairing = false;
let isConnected = false;

async function startBot() {
    const { state, saveCreds: save } = await useMultiFileAuthState("./session");
    saveCreds = save;

    const { version } = await fetchLatestBaileysVersion();
    console.log(`📡 Using WhatsApp version: ${version.join('.')}`);

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeout: 60000,
        defaultQueryTimeoutMs: 60000
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            isConnected = true;
            console.log("✅ Connection established.");
            if (!state.creds.registered && !isPairing) {
                setTimeout(startPairing, 2000);
            }
        }

        if (connection === "close") {
            isConnected = false;
            if (isPairing) {
                console.log("⏳ Waiting for pairing input... (ignore disconnect)");
                return;
            }
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("🔄 Reconnecting in 5s...");
                setTimeout(startBot, 5000);
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

    if (state.creds.registered) {
        console.log("✅ Session found – waiting for connection...");
    }
}

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
            console.log("💡 Retrying in 10 seconds...");
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
